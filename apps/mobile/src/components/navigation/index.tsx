import React from 'react';
import {
  CommonActions,
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  StackActions,
  TabActions,
  TabRouter,
  createNavigationContainerRef,
  createNavigatorFactory,
  useNavigationBuilder,
  usePreventRemove,
  type ParamListBase,
  type TabNavigationState,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
  type NativeStackNavigationProp,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, AppState, Platform, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tva } from '@gluestack-ui/utils/nativewind-utils';
import { MOTION_TIMING, TAB_BOUNCE } from '../../constants/motion';
import type { DiveLogbookSection } from '../../types/dive-session';
import type { DiveLogEntry } from '../../types/dive-log-entry';
import type { DivePlan } from '../../types/dive-plan';
import type { GuestClaimViewState } from '../../claim/guest-claim-types';
import {
  getInitialWatchSyncNotificationOpen,
  notifyWatchSyncImport,
  subscribeToWatchSyncNotificationOpens,
} from '../../notifications/watch-sync-notification-service';
import { useAppPreferences } from '../../states/app-preferences';
import {
  setAccountClaimNavigationReady,
  useAccountData,
  useOptionalAccountData,
} from '../../states/account-data';
import { useAuth, type AuthState } from '../../states/auth';
import { useDiveLogbook } from '../../states/use-dive-logbook';
import { useDivePlans } from '../../states/use-dive-plans';
import { WatchSyncProvider } from '../../states/watch-sync';
import { useFirstLoadReveal } from '../../hooks/use-first-load-reveal';
import { useLeavingValue } from '../../hooks/use-leaving-value';
import { confirmDestructiveAction } from '../../utils/confirm-destructive-action';
import { createBlankDiveLogEntry } from '../../utils/create-dive-log-entry';
import { createBlankDivePlan } from '../../utils/create-dive-plan';
import { divePlanToDiveLogEntryDraft } from '../../utils/dive-plan-to-log-entry';
import { toCompletedDivePlan, toPlannedDivePlan, withDivePlanChecklist } from '../../utils/update-dive-plan';
import { useAppFeedbackBottomInset } from '../feedback/app-feedback';
import { FeedbackLayer } from '../feedback/feedback-layer';
import { Box } from '../ui/box';
import { DetailSkeleton } from '../ui/detail-skeleton';
import { FadeInView } from '../ui/fade-in-view';
import { HStack } from '../ui/hstack';
import { BookIcon, CalendarDaysIcon, HomeIcon, Icon, SettingsIcon } from '../ui/icon';
import { InstrumentButton } from '../ui/instrument';
import { KeyboardAwareScrollView } from '../ui/keyboard-aware-scroll-view';
import { PressScalePressable } from '../ui/press-scale';
import { Text } from '../ui/text';
import { VStack } from '../ui/vstack';
import { useGluestackColors } from '../ui/gluestack-ui-provider';
import LoginScreen from '../../screens/auth/login-screen';
import OnboardingScreen from '../../screens/auth/onboarding-screen';
import AccountClaimScreen from '../../screens/account-claim/screen';
import HomeScreen from '../../screens/home/screen';
import { LogEntryDetail } from '../../screens/logbook/log-entry-detail';
import { LogEntryEditor } from '../../screens/logbook/log-entry-editor';
import { getLogEntrySuggestions } from '../../screens/logbook/log-entry-suggestions';
import LogbookScreen from '../../screens/logbook/screen';
import { PlanDetail } from '../../screens/planning/plan-detail';
import { PlanEditor } from '../../screens/planning/plan-editor';
import PlanningScreen from '../../screens/planning/screen';
import SettingsScreen, { type SettingsRoute } from '../../screens/settings/screen';

export type RootStackParamList = {
  tabs: undefined;
  authLogin: undefined;
  authOnboarding: undefined;
  accountClaim: undefined;
  logbookCreate: { draftLocalId?: string; sourcePlanLocalId?: string } | undefined;
  logbookDetail: { localId: string };
  logbookEdit: { localId: string };
  planningCreate: undefined;
  planningDetail: { localId: string };
  planningEdit: { localId: string };
  settingsDetail: { route: Exclude<SettingsRoute, 'index'> };
};

type NavigationRouteName = 'home' | 'logbook' | 'planning' | 'settings';

type AutoImportToast = {
  entryLocalId: string;
};

type PendingLogDraft = {
  entry: DiveLogEntry;
  sourcePlanLocalId?: string;
};

type AppTabNavigatorProps = {
  children: React.ReactNode;
  initialRouteName?: NavigationRouteName;
  onRouteReselect?: (routeName: NavigationRouteName) => void;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const AppTabs = createNavigatorFactory(AppTabNavigator)();
const rootStackNavigationRef = createNavigationContainerRef<RootStackParamList>();
const AUTO_IMPORT_TOAST_EDGE_GAP = 16;
// App feedback that arrives while the watch toast is up sits this far above it.
const AUTO_IMPORT_TOAST_STACK_GAP = 8;
const TAB_BAR_OVERLAY_OFFSET = 68;
const AUTH_LOGIN_SHEET_ALLOWED_DETENTS = resolveAuthLoginSheetAllowedDetents(Platform.OS, Platform.Version);

type AccountClaimAutoRouteInput = {
  authStatus: AuthState['status'];
  userId?: string;
  isOnline: boolean;
  eligibleCount: number;
  claimStatus: GuestClaimViewState['status'];
  currentRoute?: keyof RootStackParamList;
  lastRoutedUserId?: string;
};

type AccountClaimAutoRoute = {
  action: 'navigate' | 'replace';
  route: 'accountClaim';
  userId: string;
};

export function resolveAccountClaimAutoRoute({
  authStatus,
  userId,
  isOnline,
  eligibleCount,
  claimStatus,
  currentRoute,
  lastRoutedUserId,
}: AccountClaimAutoRouteInput): AccountClaimAutoRoute | undefined {
  if (
    authStatus !== 'authenticated' ||
    !userId ||
    !isOnline ||
    eligibleCount <= 0 ||
    claimStatus !== 'choice' ||
    currentRoute === 'accountClaim' ||
    lastRoutedUserId === userId
  ) {
    return undefined;
  }

  return {
    action:
      currentRoute === 'authLogin' || currentRoute === 'authOnboarding'
        ? 'replace'
        : 'navigate',
    route: 'accountClaim',
    userId,
  };
}

export function resolveHomeClaimRecoveryVisibility({
  status,
  eligibleCount,
}: {
  status: GuestClaimViewState['status'];
  eligibleCount: number;
}): boolean {
  return (
    eligibleCount > 0 && (status === 'failed' || status === 'deferred')
  );
}

export function resolveAuthLoginSheetAllowedDetents(
  platformOS: string,
  platformVersion: number | string,
): NonNullable<NativeStackNavigationOptions['sheetAllowedDetents']> {
  const majorVersion = Number.parseInt(String(platformVersion).split('.')[0] ?? '', 10);

  return platformOS === 'ios' && (!Number.isFinite(majorVersion) || majorVersion < 16) ? [0.5, 1] : 'fitToContents';
}

export function createAccountClaimSheetOptions(
  backgroundColor: string,
): NativeStackNavigationOptions {
  return {
    presentation: 'formSheet',
    sheetAllowedDetents: AUTH_LOGIN_SHEET_ALLOWED_DETENTS,
    sheetGrabberVisible: true,
    sheetCornerRadius: 28,
    contentStyle: { backgroundColor },
  };
}

export default function RootNavigation(): React.JSX.Element {
  const { t } = useTranslation();
  const { state, isConfigured, availableProviders, isDevelopmentSignInAvailable } = useAuth();
  // Login entries appear only in builds where Auth is set up and at least one way to sign in works.
  const canSignIn = isConfigured && (availableProviders.length > 0 || isDevelopmentSignInAvailable);
  const accountData = useAccountData();
  const authStatusRef = React.useRef(state.status);
  authStatusRef.current = state.status;
  const [autoImportToast, setAutoImportToast] = React.useState<AutoImportToast | undefined>();
  const [pendingLogDraft, setPendingLogDraft] = React.useState<PendingLogDraft | undefined>();
  const [navigationReady, setNavigationReady] = React.useState(false);
  const [visibleStackRoute, setVisibleStackRoute] = React.useState<keyof RootStackParamList>('tabs');
  const [autoImportToastHeight, setAutoImportToastHeight] = React.useState(0);
  // A replaced or closed toast keeps fading for the dismiss time, without taking touches.
  const leavingAutoImportToast = useLeavingValue(autoImportToast, MOTION_TIMING.dismiss);
  const chromeBottomOffset = visibleStackRoute === 'tabs' ? TAB_BAR_OVERLAY_OFFSET : 0;
  // App feedback stacks above the watch toast instead of covering its buttons.
  useAppFeedbackBottomInset(
    chromeBottomOffset + (autoImportToast ? autoImportToastHeight + AUTO_IMPORT_TOAST_STACK_GAP : 0),
  );
  const pendingNotificationOpenRef = React.useRef<string | undefined>(undefined);
  const lastRoutedClaimUserIdRef = React.useRef<string | undefined>(undefined);
  const observedClaimUserIdRef = React.useRef<string | undefined>(undefined);
  const [reselectTokens, setReselectTokens] = React.useState<Record<NavigationRouteName, number>>({
    home: 0,
    logbook: 0,
    planning: 0,
    settings: 0,
  });
  const insets = useSafeAreaInsets();
  const autoImportToastArea = { bottom: insets.bottom, left: insets.left, right: insets.right, top: insets.top };
  const palette = useGluestackColors();
  const logbook = useDiveLogbook();
  const planning = useDivePlans();
  const { isHydrated, language, resolvedTheme, watchSyncNotificationsEnabled } = useAppPreferences();
  const navigationTheme = React.useMemo(
    () => ({
      ...(resolvedTheme === 'dark' ? DarkTheme : DefaultTheme),
      colors: {
        ...(resolvedTheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
        background: palette.background,
        border: palette.border,
        card: palette.background,
        notification: palette.primary,
        primary: palette.primary,
        text: palette.foreground,
      },
    }),
    [
      palette.background,
      palette.border,
      palette.foreground,
      palette.primary,
      resolvedTheme,
    ],
  );
  const accountClaimSheetOptions = React.useMemo(
    () => createAccountClaimSheetOptions(palette.background),
    [palette.background],
  );

  const refreshVisibleStackRoute = React.useCallback(() => {
    const rootState = rootStackNavigationRef.getRootState();
    const routeName = rootState?.routes[rootState.index]?.name;
    setVisibleStackRoute((routeName ?? 'tabs') as keyof RootStackParamList);
  }, []);

  const returnToTabs = React.useCallback(() => {
    if (!rootStackNavigationRef.isReady()) {
      return;
    }

    const rootState = rootStackNavigationRef.getRootState();

    if ((rootState?.index ?? 0) === 0) {
      return;
    }

    rootStackNavigationRef.dispatch(StackActions.popToTop());
  }, []);

  const openTab = React.useCallback(
    (routeName: NavigationRouteName) => {
      rootNavigationActions.current?.navigate(routeName);
      returnToTabs();
    },
    [returnToTabs],
  );

  const openStackScreen = React.useCallback(
    <RouteName extends keyof RootStackParamList>(
      routeName: RouteName,
      params?: RootStackParamList[RouteName],
      tabName?: NavigationRouteName,
    ) => {
      if (authStatusRef.current === 'pendingOnboarding' && routeName !== 'authOnboarding') {
        return;
      }

      if (tabName) {
        rootNavigationActions.current?.navigate(tabName);
      }

      if (!rootStackNavigationRef.isReady()) {
        return;
      }

      rootStackNavigationRef.dispatch(CommonActions.navigate(routeName, params));
    },
    [],
  );

  const replaceWithLogbookCreate = React.useCallback((draft: PendingLogDraft) => {
    rootNavigationActions.current?.navigate('logbook');

    if (!rootStackNavigationRef.isReady()) {
      return;
    }

    // The log editor takes the plan detail's place, so Back lands on the Logbook tab. The earlier
    // reset rebuilt the tabs route and was refused on its first try, so the first tap did nothing.
    rootStackNavigationRef.dispatch(
      StackActions.replace('logbookCreate', {
        draftLocalId: draft.entry.localId,
        sourcePlanLocalId: draft.sourcePlanLocalId,
      }),
    );
  }, []);

  const createLogFromPlan = React.useCallback(
    (plan: DivePlan) => {
      const draft = {
        entry: divePlanToDiveLogEntryDraft(plan),
        sourcePlanLocalId: plan.localId,
      };

      setPendingLogDraft(draft);
      replaceWithLogbookCreate(draft);
    },
    [replaceWithLogbookCreate],
  );

  const markPendingDraftSaved = React.useCallback(
    async (entry: DiveLogEntry, sourcePlanLocalId?: string) => {
      setPendingLogDraft(undefined);

      if (!sourcePlanLocalId) {
        return;
      }

      const sourcePlan = planning.plans.find(plan => plan.localId === sourcePlanLocalId);

      if (!sourcePlan) {
        return;
      }

      await planning.savePlan({
        ...sourcePlan,
        convertedLogLocalId: entry.localId,
        updatedAt: Date.now() / 1000,
      });
    },
    [planning],
  );

  const openLogbook = React.useCallback(() => {
    openTab('logbook');
  }, [openTab]);

  const openLogEntryCreate = React.useCallback(() => {
    openStackScreen('logbookCreate', undefined, 'logbook');
  }, [openStackScreen]);

  const openLogEntryDetail = React.useCallback(
    (entry: DiveLogEntry) => {
      openStackScreen('logbookDetail', { localId: entry.localId }, 'logbook');
    },
    [openStackScreen],
  );

  React.useEffect(() => {
    let isMounted = true;

    getInitialWatchSyncNotificationOpen()
      .then(open => {
        if (isMounted && open) {
          if (rootStackNavigationRef.isReady()) {
            openStackScreen('logbookDetail', { localId: open.entryLocalId }, 'logbook');
          } else {
            pendingNotificationOpenRef.current = open.entryLocalId;
          }
        }
      })
      .catch(error => {
        console.warn('Failed to open initial watch sync notification', error);
      });

    const subscription = subscribeToWatchSyncNotificationOpens(open => {
      if (rootStackNavigationRef.isReady()) {
        openStackScreen('logbookDetail', { localId: open.entryLocalId }, 'logbook');
      } else {
        pendingNotificationOpenRef.current = open.entryLocalId;
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [openStackScreen]);

  const handleNavigationReady = React.useCallback(() => {
    setNavigationReady(true);
    setAccountClaimNavigationReady(true);
    refreshVisibleStackRoute();
    const pendingLocalId = pendingNotificationOpenRef.current;
    if (pendingLocalId) {
      pendingNotificationOpenRef.current = undefined;
      openStackScreen('logbookDetail', { localId: pendingLocalId }, 'logbook');
    }
  }, [openStackScreen, refreshVisibleStackRoute]);

  React.useEffect(
    () => () => {
      setAccountClaimNavigationReady(false);
    },
    [],
  );

  const openImportedLogToast = React.useCallback(() => {
    if (!autoImportToast) {
      return;
    }

    openStackScreen('logbookDetail', { localId: autoImportToast.entryLocalId }, 'logbook');
    setAutoImportToast(undefined);
  }, [autoImportToast, openStackScreen]);

  const showImportedEntryToast = React.useCallback(
    (entry: DiveLogEntry) => {
      if (AppState.currentState && AppState.currentState !== 'active') {
        return;
      }
      setAutoImportToast({ entryLocalId: entry.localId });
      // iOS has no polite live region, so say once that the toast appeared.
      AccessibilityInfo.announceForAccessibility(t('watchSync.autoImportedTitle'));
    },
    [t],
  );

  const showImportedEntryNotification = React.useCallback(
    (entry: DiveLogEntry) =>
      notifyWatchSyncImport(entry, {
        enabled: watchSyncNotificationsEnabled,
        language,
      }),
    [language, watchSyncNotificationsEnabled],
  );

  const openPlanDetail = React.useCallback(
    (plan: DivePlan) => {
      openStackScreen('planningDetail', { localId: plan.localId }, 'planning');
    },
    [openStackScreen],
  );

  const openPlanCreate = React.useCallback(() => {
    openStackScreen('planningCreate', undefined, 'planning');
  }, [openStackScreen]);

  const openSettingsDetail = React.useCallback(
    (route: Exclude<SettingsRoute, 'index'>) => {
      openStackScreen('settingsDetail', { route }, 'settings');
    },
    [openStackScreen],
  );

  const openAuthLogin = React.useCallback(() => {
    openStackScreen('authLogin');
  }, [openStackScreen]);

  const openAccountClaim = React.useCallback(() => {
    openStackScreen('accountClaim');
  }, [openStackScreen]);

  const homeRecovery = React.useMemo(() => {
    if (accountData.bootstrap.status === 'degraded') {
      return {
        title: t('home.recovery.bootstrapTitle'),
        description: t('home.recovery.bootstrapDescription'),
        actionLabel: t('common.retry'),
        onPress: accountData.retryBootstrap,
      };
    }
    if (resolveHomeClaimRecoveryVisibility({
      status: accountData.claim.state.status,
      eligibleCount:
        accountData.claim.eligible.logCount +
        accountData.claim.eligible.planCount,
    })) {
      return {
        title: t('home.recovery.claimTitle'),
        description: t('home.recovery.claimDescription'),
        actionLabel: t('home.recovery.reviewAction'),
        onPress: openAccountClaim,
      };
    }
    return undefined;
  }, [
    accountData.bootstrap.status,
    accountData.claim.eligible.logCount,
    accountData.claim.eligible.planCount,
    accountData.claim.state.status,
    accountData.retryBootstrap,
    openAccountClaim,
    t,
  ]);

  React.useEffect(() => {
    if (!navigationReady || !rootStackNavigationRef.isReady()) {
      return;
    }

    const currentRouteName = rootStackNavigationRef.getCurrentRoute()?.name;

    if (state.status === 'pendingOnboarding') {
      if (currentRouteName === 'authOnboarding') {
        return;
      }

      rootStackNavigationRef.dispatch(
        currentRouteName === 'authLogin' ? StackActions.replace('authOnboarding') : CommonActions.navigate('authOnboarding'),
      );
      return;
    }

    const authenticatedUserId =
      state.status === 'authenticated' ||
      state.status === 'authenticatedOffline'
        ? state.userId
        : undefined;
    if (observedClaimUserIdRef.current !== authenticatedUserId) {
      observedClaimUserIdRef.current = authenticatedUserId;
      lastRoutedClaimUserIdRef.current = undefined;
    }

    const accountClaimRoute = resolveAccountClaimAutoRoute({
      authStatus: state.status,
      userId: authenticatedUserId,
      isOnline: accountData.isOnline,
      eligibleCount:
        accountData.claim.eligible.logCount +
        accountData.claim.eligible.planCount,
      claimStatus: accountData.claim.state.status,
      currentRoute: currentRouteName,
      lastRoutedUserId: lastRoutedClaimUserIdRef.current,
    });

    if (accountClaimRoute) {
      lastRoutedClaimUserIdRef.current = accountClaimRoute.userId;
      rootStackNavigationRef.dispatch(
        accountClaimRoute.action === 'replace'
          ? StackActions.replace(accountClaimRoute.route)
          : CommonActions.navigate(accountClaimRoute.route),
      );
      return;
    }

    if (
      currentRouteName === 'authOnboarding' &&
      (state.status === 'guest' || state.status === 'authenticated' || state.status === 'authenticatedOffline')
    ) {
      returnToTabs();
      return;
    }

    if (currentRouteName === 'authLogin' && (state.status === 'authenticated' || state.status === 'authenticatedOffline')) {
      returnToTabs();
    }
  }, [
    accountData.claim.eligible.logCount,
    accountData.claim.eligible.planCount,
    accountData.claim.state.status,
    accountData.isOnline,
    navigationReady,
    returnToTabs,
    state,
    visibleStackRoute,
  ]);

  const reselectRoute = React.useCallback((routeName: NavigationRouteName) => {
    setReselectTokens(currentTokens => ({
      ...currentTokens,
      [routeName]: currentTokens[routeName] + 1,
    }));
  }, []);

  return (
    <WatchSyncProvider
      preferencesHydrated={isHydrated}
      notifyImportedEntry={showImportedEntryNotification}
      onImportedEntry={showImportedEntryToast}>
      <VStack
        className="flex-1 bg-background"
        style={{
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}>
        <NavigationContainer
          ref={rootStackNavigationRef}
          theme={navigationTheme}
          onReady={handleNavigationReady}
          onStateChange={refreshVisibleStackRoute}>
          <Stack.Navigator
            initialRouteName="tabs"
            screenOptions={{
              headerShown: false,
              gestureEnabled: true,
              presentation: 'card',
              contentStyle: { backgroundColor: palette.background },
            }}>
            <Stack.Screen name="tabs">
              {() => (
                <AppTabs.Navigator initialRouteName="home" onRouteReselect={reselectRoute}>
                  <AppTabs.Screen name="home">
                    {() => (
                      <HomeScreen
                        sessions={logbook.sessions}
                        latestEntry={logbook.entries[0]}
                        onOpenLog={openLogEntryDetail}
                        plans={planning.plans}
                        onOpenPlan={openPlanDetail}
                        onCreateLog={openLogEntryCreate}
                        onCreatePlan={openPlanCreate}
                        onOpenLogin={openAuthLogin}
                        showLogin={state.status === 'guest' && canSignIn}
                        onRefresh={logbook.refresh}
                        isLoading={logbook.isLoading}
                        isRefreshing={logbook.isRefreshing}
                        loadError={logbook.listError}
                        reselectToken={reselectTokens.home}
                        recovery={homeRecovery}
                      />
                    )}
                  </AppTabs.Screen>
                  <AppTabs.Screen name="logbook">
                    {() => (
                      <LogbookScreen
                        entries={logbook.filteredEntries}
                        totalEntryCount={logbook.entries.length}
                        loadError={logbook.listError}
                        filter={logbook.filter}
                        onFilterChange={logbook.setFilter}
                        onSyncWatch={logbook.syncWatchPayloads}
                        onRefresh={logbook.refresh}
                        isLoading={logbook.isLoading}
                        isCloudLoading={logbook.isCloudLoading}
                        reselectToken={reselectTokens.logbook}
                        onOpenEntry={openLogEntryDetail}
                        onCreateEntry={openLogEntryCreate}
                        isAuthenticated={state.status === 'authenticated' || state.status === 'authenticatedOffline'}
                      />
                    )}
                  </AppTabs.Screen>
                  <AppTabs.Screen name="planning">
                    {() => (
                      <PlanningScreen
                        plans={planning.plans}
                        loadError={planning.listError}
                        onRefresh={planning.refresh}
                        isLoading={planning.isLoading}
                        isRefreshing={planning.isRefreshing}
                        reselectToken={reselectTokens.planning}
                        onCreatePlan={openPlanCreate}
                        onOpenPlan={openPlanDetail}
                        onOpenLogbook={openLogbook}
                        isAuthenticated={state.status === 'authenticated' || state.status === 'authenticatedOffline'}
                      />
                    )}
                  </AppTabs.Screen>
                  <AppTabs.Screen name="settings">
                    {() => (
                      <SettingsScreen
                        route="index"
                        onOpenLogin={openAuthLogin}
                        onOpenRoute={openSettingsDetail}
                        accountClaim={{
                          isOnline: accountData.isOnline,
                          eligible: accountData.claim.eligible,
                          state: accountData.claim.state,
                        }}
                        onOpenAccountClaim={openAccountClaim}
                      />
                    )}
                  </AppTabs.Screen>
                </AppTabs.Navigator>
              )}
            </Stack.Screen>
            <Stack.Screen
              name="authLogin"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: AUTH_LOGIN_SHEET_ALLOWED_DETENTS,
                sheetGrabberVisible: true,
                sheetCornerRadius: 28,
                contentStyle: { backgroundColor: palette.background },
              }}>
              {props => <AuthLoginRoute {...props} />}
            </Stack.Screen>
            <Stack.Screen
              name="accountClaim"
              options={accountClaimSheetOptions}>
              {() => <AccountClaimScreen />}
            </Stack.Screen>
            <Stack.Screen name="authOnboarding" options={{ gestureEnabled: false, presentation: 'modal' }}>
              {() => <AuthOnboardingRoute />}
            </Stack.Screen>
            <Stack.Screen name="logbookCreate">
              {props => (
                <LogbookCreateRoute
                  {...props}
                  logbook={logbook}
                  pendingDraft={pendingLogDraft}
                  onPendingDraftSaved={markPendingDraftSaved}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="logbookDetail">{props => <LogbookDetailRoute {...props} logbook={logbook} />}</Stack.Screen>
            <Stack.Screen name="logbookEdit">{props => <LogbookEditRoute {...props} logbook={logbook} />}</Stack.Screen>
            <Stack.Screen name="planningCreate">{props => <PlanningCreateRoute {...props} planning={planning} />}</Stack.Screen>
            <Stack.Screen name="planningDetail">
              {props => (
                <PlanningDetailRoute
                  {...props}
                  logbook={logbook}
                  planning={planning}
                  onCreateLogFromPlan={createLogFromPlan}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="planningEdit">{props => <PlanningEditRoute {...props} planning={planning} />}</Stack.Screen>
            <Stack.Screen name="settingsDetail">
              {props => (
                <SettingsScreen
                  route={props.route.params.route}
                  onBack={() => props.navigation.goBack()}
                  accountClaim={{
                    isOnline: accountData.isOnline,
                    eligible: accountData.claim.eligible,
                    state: accountData.claim.state,
                  }}
                  onOpenAccountClaim={openAccountClaim}
                  loadPendingChangeCount={async () => {
                    const outbox = accountData.outbox;
                    if (!outbox) {
                      return 0;
                    }
                    // A change held back by a conflict has not reached the account either.
                    const [items, conflicts] = await Promise.all([outbox.list(), outbox.listConflicts()]);
                    return items.length + conflicts.length;
                  }}
                  syncPendingChanges={accountData.requestSync}
                  isCloudRefreshing={accountData.isCloudRefreshing}
                />
              )}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
        {leavingAutoImportToast ? (
          <FeedbackLayer
            key={leavingAutoImportToast.entryLocalId}
            leaving
            className="absolute z-10 overflow-hidden"
            style={autoImportToastArea}>
            <WatchAutoImportToastCard bottomOffset={AUTO_IMPORT_TOAST_EDGE_GAP + chromeBottomOffset} inert />
          </FeedbackLayer>
        ) : null}
        {autoImportToast ? (
          <FeedbackLayer
            key={autoImportToast.entryLocalId}
            testID="watch-auto-import-toast-safe-area"
            className="absolute z-10 overflow-hidden"
            style={autoImportToastArea}>
            {/* Unlike app feedback this carries an action, so it stays until the diver closes it.
                Not one accessibility element: VoiceOver reaches each button on its own. */}
            <WatchAutoImportToastCard
              bottomOffset={AUTO_IMPORT_TOAST_EDGE_GAP + chromeBottomOffset}
              onOpen={openImportedLogToast}
              onDismiss={() => setAutoImportToast(undefined)}
              onLayout={event => setAutoImportToastHeight(event.nativeEvent.layout.height)}
            />
          </FeedbackLayer>
        ) : null}
      </VStack>
    </WatchSyncProvider>
  );
}

function AuthLoginRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'authLogin'>): React.JSX.Element {
  const { state } = useAuth();

  usePreventRemove(state.status === 'authenticating', () => undefined);

  return <LoginScreen onClose={() => navigation.goBack()} />;
}

function AuthOnboardingRoute(): React.JSX.Element {
  const { state } = useAuth();

  usePreventRemove(state.status === 'pendingOnboarding', () => undefined);

  return <OnboardingScreen />;
}

function AppTabNavigator({ children, initialRouteName, onRouteReselect }: AppTabNavigatorProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { state, navigation, descriptors, NavigationContent } = useNavigationBuilder<
    TabNavigationState<ParamListBase>,
    {
      initialRouteName?: string;
      backBehavior?: 'history';
      children: React.ReactNode;
    },
    Record<string, never>,
    Record<string, never>,
    Record<string, never>
  >(TabRouter, {
    children,
    initialRouteName,
    backBehavior: 'history',
  });
  const focusedRoute = state.routes[state.index];

  React.useEffect(() => {
    rootNavigationActions.current = {
      navigate: routeName => {
        navigation.dispatch({
          ...TabActions.jumpTo(routeName),
          target: state.key,
        });
      },
    };

    return () => {
      rootNavigationActions.current = undefined;
    };
  }, [navigation, state.key]);

  return (
    <NavigationContent>
      <VStack className="flex-1 bg-background">{descriptors[focusedRoute.key].render()}</VStack>

      <HStack accessibilityRole="tablist" className="bg-card px-2 pt-1" style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
        {state.routes.map(route => {
          const selected = route.key === focusedRoute.key;
          const routeName = route.name as DiveLogbookSection;

          return (
            <NavTab
              key={route.key}
              id={routeName}
              label={t(`navigation.${route.name}`)}
              selected={selected}
              onPress={() => {
                if (!selected) {
                  navigation.dispatch({
                    ...TabActions.jumpTo(route.name),
                    target: state.key,
                  });
                  return;
                }

                onRouteReselect?.(route.name as NavigationRouteName);
              }}
            />
          );
        })}
      </HStack>
    </NavigationContent>
  );
}

/**
 * The watch import card. It uses the inverted app-feedback surface, so it never blends into the
 * list cards below. A leaving copy is inert: no press and no test IDs.
 */
function WatchAutoImportToastCard(props: {
  bottomOffset: number;
  inert?: boolean;
  onOpen?: () => void;
  onDismiss?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { bottomOffset, inert = false, onOpen, onDismiss, onLayout } = props;
  const body = (
    <VStack space="sm">
      <Text testID={inert ? undefined : 'watch-auto-import-message'} className="text-sm font-semibold text-background">
        {t('watchSync.autoImportedTitle', {
          defaultValue: 'Watch log saved',
        })}
      </Text>
      <HStack space="sm" className="pt-1">
        <InstrumentButton
          testID={inert ? undefined : 'watch-auto-import-open-log'}
          label={t('watchSync.openImportedLog', {
            defaultValue: 'View log',
          })}
          variant="primary"
          onPress={onOpen}
          className="min-h-11 flex-1 px-4 py-2"
        />
        <InstrumentButton
          testID={inert ? undefined : 'watch-auto-import-dismiss'}
          label={t('watchSync.dismiss', { defaultValue: 'Close' })}
          onPress={onDismiss}
          className="min-h-11 flex-1 px-4 py-2"
        />
      </HStack>
    </VStack>
  );

  if (inert) {
    return (
      <Box className="absolute left-4 right-4 rounded-2xl bg-foreground px-4 py-3" style={{ bottom: bottomOffset }}>
        {body}
      </Box>
    );
  }

  return (
    <PressScalePressable
      kind="card"
      testID="watch-auto-import-toast"
      accessible={false}
      onPress={onOpen}
      onLayout={onLayout}
      className="absolute left-4 right-4 rounded-2xl bg-foreground px-4 py-3"
      style={{ bottom: bottomOffset }}>
      {body}
    </PressScalePressable>
  );
}

function LogbookCreateRoute(
  props: NativeStackScreenProps<RootStackParamList, 'logbookCreate'> & {
    logbook: ReturnType<typeof useDiveLogbook>;
    pendingDraft?: PendingLogDraft;
    onPendingDraftSaved: (entry: DiveLogEntry, sourcePlanLocalId?: string) => Promise<void>;
  },
): React.JSX.Element {
  const [entry] = React.useState(() => {
    const routeDraftLocalId = props.route.params?.draftLocalId;

    if (props.pendingDraft && props.pendingDraft.entry.localId === routeDraftLocalId) {
      return props.pendingDraft.entry;
    }

    return createBlankDiveLogEntry();
  });

  return (
    <RoutedLogEditor
      navigation={props.navigation}
      entry={entry}
      mode="create"
      logbook={props.logbook}
      afterSave={savedEntry => props.onPendingDraftSaved(savedEntry, props.route.params?.sourcePlanLocalId)}
      // A new log opens its detail in place of the editor.
      onSaved={savedEntry => props.navigation.replace('logbookDetail', { localId: savedEntry.localId })}
    />
  );
}

function LogbookDetailRoute(
  props: NativeStackScreenProps<RootStackParamList, 'logbookDetail'> & {
    logbook: ReturnType<typeof useDiveLogbook>;
  },
): React.JSX.Element {
  const listEntry = props.logbook.entries.find(nextEntry => nextEntry.localId === props.route.params.localId);
  // A deleted log leaves the list before the screen finishes leaving; keep showing it until then.
  const [deletingEntry, setDeletingEntry] = React.useState<DiveLogEntry>();
  const entry = listEntry ?? deletingEntry;
  const [profile, setProfile] = React.useState(() => ({
    samples: listEntry?.watchCapture?.samples ?? [],
    isLoading: true,
  }));
  const { loadWatchProfile } = props.logbook;
  const accountData = useOptionalAccountData();
  // The detail replaces the skeleton once the list has the log. A refetch or an edit never fades.
  const revealDetail = useFirstLoadReveal(!entry && Boolean(props.logbook.isLoading));

  React.useEffect(() => {
    let mounted = true;
    loadWatchProfile(props.route.params.localId)
      .then(samples => {
        if (mounted) {
          setProfile({ samples, isLoading: false });
        }
      })
      .catch(() => {
        if (mounted) {
          setProfile(current => ({ ...current, isLoading: false }));
        }
      });
    return () => {
      mounted = false;
    };
  }, [loadWatchProfile, props.route.params.localId]);

  if (!entry) {
    return <MissingRouteScreen navigation={props.navigation} kind="logbook" list={props.logbook} />;
  }

  return (
    <RoutedScrollScreen>
      <FadeInView animate={revealDetail}>
        <LogEntryDetail
          entry={entry}
          profileSamples={profile.samples}
          isProfileLoading={profile.isLoading}
          onBack={() => props.navigation.goBack()}
          onEdit={nextEntry =>
            props.navigation.navigate('logbookEdit', {
              localId: nextEntry.localId,
            })
          }
          onDelete={async localId => {
            setDeletingEntry(entry);
            try {
              await props.logbook.deleteEntry(localId);
            } catch (error) {
              setDeletingEntry(undefined);
              throw error;
            }
            props.navigation.goBack();
          }}
          onResolveConflict={
            accountData?.resolveConflict
              ? choice => accountData.resolveConflict!('log', entry.localId, choice)
              : undefined
          }
        />
      </FadeInView>
    </RoutedScrollScreen>
  );
}

function LogbookEditRoute(
  props: NativeStackScreenProps<RootStackParamList, 'logbookEdit'> & {
    logbook: ReturnType<typeof useDiveLogbook>;
  },
): React.JSX.Element {
  const entry = props.logbook.entries.find(nextEntry => nextEntry.localId === props.route.params.localId);

  if (!entry) {
    return <MissingRouteScreen navigation={props.navigation} kind="logbook" list={props.logbook} />;
  }

  return (
    <RoutedLogEditor
      navigation={props.navigation}
      entry={entry}
      mode="edit"
      logbook={props.logbook}
      // The detail this editor came from is still below it and shows the saved log.
      onSaved={() => props.navigation.goBack()}
    />
  );
}

/**
 * The log editor as a full-screen route: its sticky save bar stays at the bottom of the screen,
 * and leaving with unsaved edits asks first.
 */
function RoutedLogEditor(props: {
  navigation: Pick<NativeStackNavigationProp<RootStackParamList>, 'goBack' | 'dispatch'>;
  entry: DiveLogEntry;
  mode: 'create' | 'edit';
  logbook: ReturnType<typeof useDiveLogbook>;
  /** Runs after the log is saved and before the editor leaves, for example to link the source plan. */
  afterSave?: (entry: DiveLogEntry) => Promise<void>;
  onSaved: (entry: DiveLogEntry) => void;
}): React.JSX.Element {
  const { navigation } = props;
  const discardGuard = useDiscardChangesGuard(navigation);
  const suggestions = React.useMemo(
    () => getLogEntrySuggestions(props.logbook.entries, props.entry.localId),
    [props.entry.localId, props.logbook.entries],
  );

  return (
    <LogEntryEditor
      entry={props.entry}
      mode={props.mode}
      suggestions={suggestions}
      onCancel={() => navigation.goBack()}
      onDirtyChange={discardGuard.setDirty}
      onSave={async nextEntry => {
        const savedEntry = await props.logbook.saveEntry(nextEntry);
        await props.afterSave?.(savedEntry);
        discardGuard.markLeavingAfterSave();
        props.onSaved(savedEntry);
        return savedEntry;
      }}
    />
  );
}

function PlanningCreateRoute(
  props: NativeStackScreenProps<RootStackParamList, 'planningCreate'> & {
    planning: ReturnType<typeof useDivePlans>;
  },
): React.JSX.Element {
  const [plan] = React.useState(() => createBlankDivePlan());

  return (
    <RoutedPlanEditor
      navigation={props.navigation}
      plan={plan}
      mode="create"
      planning={props.planning}
      // A new plan opens its detail in place of the editor.
      onSaved={savedPlan => props.navigation.replace('planningDetail', { localId: savedPlan.localId })}
    />
  );
}

function PlanningDetailRoute(
  props: NativeStackScreenProps<RootStackParamList, 'planningDetail'> & {
    logbook: ReturnType<typeof useDiveLogbook>;
    planning: ReturnType<typeof useDivePlans>;
    onCreateLogFromPlan: (plan: DivePlan) => void;
  },
): React.JSX.Element {
  const plan = props.planning.plans.find(nextPlan => nextPlan.localId === props.route.params.localId);
  const accountData = useOptionalAccountData();
  const hasExistingConvertedLog = Boolean(
    plan?.convertedLogLocalId && props.logbook.entries.some(entry => entry.localId === plan.convertedLogLocalId),
  );
  // The plan detail replaces the skeleton once the list has the plan. A refetch or an edit never fades.
  const revealPlan = useFirstLoadReveal(!plan && Boolean(props.planning.isLoading));

  if (!plan) {
    return <MissingRouteScreen navigation={props.navigation} kind="planning" list={props.planning} />;
  }

  return (
    <RoutedScrollScreen>
      <FadeInView animate={revealPlan}>
        <PlanDetail
          plan={plan}
          onBack={() => props.navigation.goBack()}
          onEdit={nextPlan =>
            props.navigation.navigate('planningEdit', {
              localId: nextPlan.localId,
            })
          }
          // The detail checks the required fields before it calls this.
          onPromote={nextPlan => props.planning.savePlan(toPlannedDivePlan(nextPlan))}
          onComplete={nextPlan => props.planning.savePlan(toCompletedDivePlan(nextPlan))}
          onDelete={async localId => {
            await props.planning.deletePlan(localId);
            props.navigation.goBack();
          }}
          onCreateLogFromPlan={props.onCreateLogFromPlan}
          hasExistingConvertedLog={hasExistingConvertedLog}
          onOpenConvertedLog={localId => props.navigation.navigate('logbookDetail', { localId })}
          onSaveChecklist={checklistItems => props.planning.savePlan(withDivePlanChecklist(plan, checklistItems))}
          watchSyncStatus={props.planning.plannedWatchSyncStatus}
          watchSentPlanVersions={props.planning.plannedWatchSentVersions}
          onResolveConflict={
            accountData?.resolveConflict
              ? choice => accountData.resolveConflict!('plan', plan.localId, choice)
              : undefined
          }
        />
      </FadeInView>
    </RoutedScrollScreen>
  );
}

function PlanningEditRoute(
  props: NativeStackScreenProps<RootStackParamList, 'planningEdit'> & {
    planning: ReturnType<typeof useDivePlans>;
  },
): React.JSX.Element {
  const plan = props.planning.plans.find(nextPlan => nextPlan.localId === props.route.params.localId);

  if (!plan) {
    return <MissingRouteScreen navigation={props.navigation} kind="planning" list={props.planning} />;
  }

  return (
    <RoutedPlanEditor
      navigation={props.navigation}
      plan={plan}
      mode="edit"
      planning={props.planning}
      // The detail this editor came from is still below it and shows the saved plan.
      onSaved={() => props.navigation.goBack()}
    />
  );
}

/**
 * The plan editor as a full-screen route: its sticky save bar stays at the bottom of the screen,
 * and leaving with unsaved edits asks first.
 */
function RoutedPlanEditor(props: {
  navigation: Pick<NativeStackNavigationProp<RootStackParamList>, 'goBack' | 'dispatch'>;
  plan: DivePlan;
  mode: 'create' | 'edit';
  planning: ReturnType<typeof useDivePlans>;
  onSaved: (plan: DivePlan) => void;
}): React.JSX.Element {
  const { navigation } = props;
  const discardGuard = useDiscardChangesGuard(navigation);

  return (
    <PlanEditor
      plan={props.plan}
      mode={props.mode}
      isSaving={props.planning.isSaving}
      onCancel={() => navigation.goBack()}
      onDirtyChange={discardGuard.setDirty}
      onSave={async nextPlan => {
        const savedPlan = await props.planning.savePlan(nextPlan);
        discardGuard.markLeavingAfterSave();
        props.onSaved(savedPlan);
        return savedPlan;
      }}
    />
  );
}

/**
 * Asks before an editor route closes with unsaved edits. A route that leaves after a save calls
 * `markLeavingAfterSave` first, so that exit does not ask.
 */
function useDiscardChangesGuard(navigation: Pick<NativeStackNavigationProp<RootStackParamList>, 'dispatch'>): {
  setDirty: (isDirty: boolean) => void;
  markLeavingAfterSave: () => void;
} {
  const { t } = useTranslation();
  const leavingAfterSaveRef = React.useRef(false);
  const [isDirty, setDirty] = React.useState(false);

  usePreventRemove(isDirty, ({ data }) => {
    if (leavingAfterSaveRef.current) {
      navigation.dispatch(data.action);
      return;
    }

    confirmDestructiveAction({
      title: t('common.discardChanges.title'),
      message: t('common.discardChanges.message'),
      cancelLabel: t('common.discardChanges.keepEditing'),
      confirmLabel: t('common.discardChanges.discard'),
      onConfirm: () => navigation.dispatch(data.action),
    });
  });

  const markLeavingAfterSave = React.useCallback(() => {
    leavingAfterSaveRef.current = true;
  }, []);

  return { setDirty, markLeavingAfterSave };
}

function RoutedScrollScreen(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <KeyboardAwareScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-5 pt-4 pb-6"
      contentInsetAdjustmentBehavior="automatic">
      <VStack space="lg">{props.children}</VStack>
    </KeyboardAwareScrollView>
  );
}

type RouteListState = {
  isLoading: boolean;
  isRefreshing: boolean;
  listError: unknown;
  refresh: () => Promise<void>;
};

function MissingRouteScreen(props: {
  navigation: NativeStackNavigationProp<RootStackParamList>;
  /** The list the item comes from; it names the load-failed copy. */
  kind: 'logbook' | 'planning';
  /**
   * The item may just not be there yet (first load) or the list may have failed to load. Only a
   * list that loaded without the item means it is gone.
   */
  list: RouteListState;
}): React.JSX.Element {
  const { t } = useTranslation();

  if (props.list.listError) {
    return (
      <RoutedScrollScreen>
        <VStack testID="navigation-route-load-failed" space="md" className="rounded-2xl bg-card px-4 py-4">
          <Text className="text-lg font-semibold text-card-foreground">{t(`${props.kind}.loadFailed`)}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">{t(`${props.kind}.loadFailedMessage`)}</Text>
          <InstrumentButton
            testID="navigation-route-retry"
            variant="primary"
            label={t('common.retry')}
            pending={props.list.isRefreshing}
            onPress={() => {
              // A failed retry shows up as the list error again.
              props.list.refresh().catch(() => undefined);
            }}
          />
          <InstrumentButton label={t('logbook.backToList', { defaultValue: 'Back to list' })} onPress={() => props.navigation.goBack()} />
        </VStack>
      </RoutedScrollScreen>
    );
  }

  if (props.list.isLoading) {
    return (
      <RoutedScrollScreen>
        <DetailSkeleton testID="navigation-route-loading" onBack={() => props.navigation.goBack()} />
      </RoutedScrollScreen>
    );
  }

  return (
    <RoutedScrollScreen>
      <VStack testID="navigation-missing-route" space="md" className="rounded-2xl bg-card px-4 py-4">
        <Text className="text-lg font-semibold text-card-foreground">
          {t('navigation.missingRouteTitle', {
            defaultValue: 'Screen unavailable',
          })}
        </Text>
        <Text className="text-sm leading-5 text-muted-foreground">
          {t('navigation.missingRouteBody', {
            defaultValue: 'The item may have been deleted or is no longer available on this device.',
          })}
        </Text>
        <InstrumentButton label={t('logbook.backToList', { defaultValue: 'Back to list' })} onPress={() => props.navigation.goBack()} />
      </VStack>
    </RoutedScrollScreen>
  );
}

const rootNavigationActions = {
  current: undefined as
    | {
        navigate: (routeName: NavigationRouteName) => void;
      }
    | undefined,
};

const navTabStyles = tva({
  base: 'min-h-12 flex-1 items-center justify-center py-1',
  variants: {
    selected: {
      true: 'bg-transparent',
      false: 'bg-transparent',
    },
  },
  defaultVariants: {
    selected: false,
  },
});

const navTabIconStyles = tva({
  base: 'mb-0.5',
  variants: {
    selected: {
      true: 'text-primary',
      false: 'text-muted-foreground',
    },
  },
  defaultVariants: {
    selected: false,
  },
});

const NAV_TAB_ICONS: Record<DiveLogbookSection, React.ElementType> = {
  home: HomeIcon,
  logbook: BookIcon,
  planning: CalendarDaysIcon,
  settings: SettingsIcon,
};

const navTabTextStyles = tva({
  base: 'text-xs font-semibold',
  variants: {
    selected: {
      true: 'text-primary',
      false: 'text-muted-foreground',
    },
  },
  defaultVariants: {
    selected: false,
  },
});

function NavTab(props: { id: DiveLogbookSection; label: string; selected: boolean; onPress: () => void }): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const iconScale = useSharedValue(1);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.get() }] }));
  // Only a tap that moves the selection bounces the icon. Re-taps and selection set elsewhere do not;
  // a tap whose dispatch changed nothing expires instead of bouncing a later programmatic selection.
  const tappedAtRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    const tappedAt = tappedAtRef.current;
    if (!props.selected || tappedAt === undefined) {
      return;
    }
    tappedAtRef.current = undefined;
    if (reduceMotion || Date.now() - tappedAt > TAB_BOUNCE.tapWindow) {
      return;
    }
    iconScale.set(
      withSequence(
        withTiming(TAB_BOUNCE.scale, { duration: TAB_BOUNCE.dip, easing: Easing.out(Easing.quad) }),
        withSpring(1, TAB_BOUNCE.rebound),
      ),
    );
  }, [iconScale, props.selected, reduceMotion]);

  const handlePress = () => {
    if (!props.selected) {
      tappedAtRef.current = Date.now();
    }
    props.onPress();
  };

  return (
    <PressScalePressable
      kind="control"
      onPress={handlePress}
      testID={`nav-tab-${props.id}`}
      accessibilityRole="tab"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.selected }}
      className={navTabStyles({ selected: props.selected })}>
      <Animated.View style={iconStyle}>
        <Icon as={NAV_TAB_ICONS[props.id]} size="lg" className={navTabIconStyles({ selected: props.selected })} />
      </Animated.View>
      <Text className={navTabTextStyles({ selected: props.selected })}>{props.label}</Text>
    </PressScalePressable>
  );
}
