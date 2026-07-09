import React from 'react';
import {
  CommonActions,
  NavigationContainer,
  StackActions,
  TabActions,
  TabRouter,
  createNavigationContainerRef,
  createNavigatorFactory,
  useNavigationBuilder,
  type ParamListBase,
  type TabNavigationState,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tva } from '@gluestack-ui/utils/nativewind-utils';
import type { DiveLogbookSection } from '../../types/dive-session';
import type { DiveLogEntry } from '../../types/dive-log-entry';
import type { DivePlan } from '../../types/dive-plan';
import {
  getInitialWatchSyncNotificationOpen,
  notifyWatchSyncImport,
  subscribeToWatchSyncNotificationOpens,
} from '../../notifications/watch-sync-notification-service';
import { useAppPreferences } from '../../states/app-preferences';
import { useDiveLogbook } from '../../states/use-dive-logbook';
import { useDivePlans } from '../../states/use-dive-plans';
import { WatchConnectivitySyncProvider } from '../../states/watch-connectivity-sync';
import { createBlankDiveLogEntry } from '../../utils/create-dive-log-entry';
import { createBlankDivePlan } from '../../utils/create-dive-plan';
import { divePlanToDiveLogEntryDraft } from '../../utils/dive-plan-to-log-entry';
import { Box } from '../ui/box';
import { HStack } from '../ui/hstack';
import { InstrumentButton } from '../ui/instrument';
import { KeyboardAwareScrollView } from '../ui/keyboard-aware-scroll-view';
import { Pressable } from '../ui/pressable';
import { Text } from '../ui/text';
import { VStack } from '../ui/vstack';
import HomeScreen from '../../screens/home/screen';
import { LogEntryDetail } from '../../screens/logbook/log-entry-detail';
import { LogEntryEditor } from '../../screens/logbook/log-entry-editor';
import LogbookScreen from '../../screens/logbook/screen';
import { PlanDetail } from '../../screens/planning/plan-detail';
import { PlanEditor } from '../../screens/planning/plan-editor';
import PlanningScreen, { isPlanReadyForPromotion } from '../../screens/planning/screen';
import SettingsScreen, { type SettingsRoute } from '../../screens/settings/screen';

export type RootStackParamList = {
  tabs: undefined;
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
  siteName: string;
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

type AppTabScreenProps = {
  name: NavigationRouteName;
  children: () => React.ReactNode;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const AppTabs = createNavigatorFactory(AppTabNavigator)();
const rootStackNavigationRef = createNavigationContainerRef<RootStackParamList>();
const AUTO_IMPORT_TOAST_EDGE_GAP = 16;
const AUTO_IMPORT_TOAST_TAB_OFFSET = 68;

export default function RootNavigation(): React.JSX.Element {
  const { t } = useTranslation();
  const [autoImportToast, setAutoImportToast] = React.useState<AutoImportToast | undefined>();
  const [pendingLogDraft, setPendingLogDraft] = React.useState<PendingLogDraft | undefined>();
  const [completedPromptPlan, setCompletedPromptPlan] = React.useState<DivePlan | undefined>();
  const [visibleStackRoute, setVisibleStackRoute] = React.useState<keyof RootStackParamList>('tabs');
  const [reselectTokens, setReselectTokens] = React.useState<Record<NavigationRouteName, number>>({
    home: 0,
    logbook: 0,
    planning: 0,
    settings: 0,
  });
  const insets = useSafeAreaInsets();
  const logbook = useDiveLogbook();
  const planning = useDivePlans();
  const { language, watchSyncNotificationsEnabled } = useAppPreferences();

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

  const resetToLogbookCreate = React.useCallback((draft: PendingLogDraft) => {
    rootNavigationActions.current?.navigate('logbook');

    if (!rootStackNavigationRef.isReady()) {
      return;
    }

    rootStackNavigationRef.dispatch(
      CommonActions.reset({
        index: 1,
        routes: [
          { name: 'tabs' },
          {
            name: 'logbookCreate',
            params: {
              draftLocalId: draft.entry.localId,
              sourcePlanLocalId: draft.sourcePlanLocalId,
            },
          },
        ],
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
      resetToLogbookCreate(draft);
    },
    [resetToLogbookCreate],
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

  const openPlanning = React.useCallback(() => {
    openTab('planning');
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
          openStackScreen('logbookDetail', { localId: open.entryLocalId }, 'logbook');
        }
      })
      .catch(error => {
        console.warn('Failed to open initial watch sync notification', error);
      });

    const subscription = subscribeToWatchSyncNotificationOpens(open => {
      openStackScreen('logbookDetail', { localId: open.entryLocalId }, 'logbook');
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [openStackScreen]);

  const openImportedLogToast = React.useCallback(() => {
    if (!autoImportToast) {
      return;
    }

    openStackScreen('logbookDetail', { localId: autoImportToast.entryLocalId }, 'logbook');
    setAutoImportToast(undefined);
  }, [autoImportToast, openStackScreen]);

  const showImportedEntryToast = React.useCallback(
    (entry: DiveLogEntry) => {
      setAutoImportToast({
        entryLocalId: entry.localId,
        siteName: entry.manual.site.name ?? entry.watchCapture?.session.siteName ?? t('logbook.untitledDive'),
      });
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

  const reselectRoute = React.useCallback((routeName: NavigationRouteName) => {
    setReselectTokens(currentTokens => ({
      ...currentTokens,
      [routeName]: currentTokens[routeName] + 1,
    }));
  }, []);

  const onPlanCompleted = React.useCallback(
    (plan: DivePlan) => {
      setCompletedPromptPlan(plan);
      openTab('planning');
    },
    [openTab],
  );

  return (
    <WatchConnectivitySyncProvider
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
          onReady={refreshVisibleStackRoute}
          onStateChange={refreshVisibleStackRoute}>
          <Stack.Navigator
            initialRouteName="tabs"
            screenOptions={{
              headerShown: false,
              gestureEnabled: true,
              presentation: 'card',
            }}>
            <Stack.Screen name="tabs">
              {() => (
                <AppTabs.Navigator initialRouteName="home" onRouteReselect={reselectRoute}>
                  <AppTabs.Screen name="home">
                    {() => (
                      <HomeScreen
                        sessions={logbook.sessions}
                        onOpenLogbook={openLogbook}
                        onOpenPlanning={openPlanning}
                        onRefresh={logbook.refresh}
                        isLoading={logbook.isLoading}
                        isRefreshing={logbook.isRefreshing}
                        reselectToken={reselectTokens.home}
                      />
                    )}
                  </AppTabs.Screen>
                  <AppTabs.Screen name="logbook">
                    {() => (
                      <LogbookScreen
                        entries={logbook.filteredEntries}
                        filter={logbook.filter}
                        onFilterChange={logbook.setFilter}
                        onSyncWatch={logbook.syncWatchPayloads}
                        onRefresh={logbook.refresh}
                        isLoading={logbook.isLoading}
                        isRefreshing={logbook.isRefreshing}
                        reselectToken={reselectTokens.logbook}
                        onSaveEntry={logbook.saveEntry}
                        onDeleteEntry={logbook.deleteEntry}
                        saveError={logbook.saveError}
                        isSaving={logbook.isSaving}
                        onOpenEntry={openLogEntryDetail}
                        onCreateEntry={openLogEntryCreate}
                      />
                    )}
                  </AppTabs.Screen>
                  <AppTabs.Screen name="planning">
                    {() => (
                      <PlanningScreen
                        sessions={logbook.sessions}
                        plans={planning.plans}
                        onRefresh={planning.refresh}
                        isLoading={planning.isLoading}
                        isRefreshing={planning.isRefreshing}
                        reselectToken={reselectTokens.planning}
                        onSavePlan={planning.savePlan}
                        onDeletePlan={planning.deletePlan}
                        saveError={planning.saveError}
                        isSaving={planning.isSaving}
                        onCreatePlan={openPlanCreate}
                        onOpenPlan={openPlanDetail}
                        onCreateLogFromPlan={createLogFromPlan}
                        logEntryIds={logbook.entries.map(entry => entry.localId)}
                        onOpenLogbook={openLogbook}
                        completedPromptPlan={completedPromptPlan}
                        onCompletedPromptLater={() => setCompletedPromptPlan(undefined)}
                        onCreateLogFromCompletedPlan={plan => {
                          setCompletedPromptPlan(undefined);
                          createLogFromPlan(plan);
                        }}
                      />
                    )}
                  </AppTabs.Screen>
                  <AppTabs.Screen name="settings">
                    {() => <SettingsScreen route="index" onOpenRoute={openSettingsDetail} />}
                  </AppTabs.Screen>
                </AppTabs.Navigator>
              )}
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
            <Stack.Screen name="logbookDetail">
              {props => <LogbookDetailRoute {...props} logbook={logbook} />}
            </Stack.Screen>
            <Stack.Screen name="logbookEdit">
              {props => <LogbookEditRoute {...props} logbook={logbook} />}
            </Stack.Screen>
            <Stack.Screen name="planningCreate">
              {props => <PlanningCreateRoute {...props} planning={planning} />}
            </Stack.Screen>
            <Stack.Screen name="planningDetail">
              {props => (
                <PlanningDetailRoute
                  {...props}
                  logbook={logbook}
                  planning={planning}
                  onCreateLogFromPlan={createLogFromPlan}
                  onPlanCompleted={onPlanCompleted}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="planningEdit">
              {props => <PlanningEditRoute {...props} planning={planning} />}
            </Stack.Screen>
            <Stack.Screen name="settingsDetail">
              {props => <SettingsScreen route={props.route.params.route} onBack={() => props.navigation.goBack()} />}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
        {autoImportToast ? (
          <Box
            testID="watch-auto-import-toast-safe-area"
            pointerEvents="box-none"
            className="absolute z-10 overflow-hidden"
            style={{
              bottom: insets.bottom,
              left: insets.left,
              right: insets.right,
              top: insets.top,
            }}>
            <Pressable
              testID="watch-auto-import-toast"
              onPress={openImportedLogToast}
              className="absolute left-4 right-4 rounded-2xl bg-card px-4 py-3 shadow-sm"
              style={({ pressed }) => [
                {
                  bottom:
                    AUTO_IMPORT_TOAST_EDGE_GAP +
                    (visibleStackRoute === 'tabs' ? AUTO_IMPORT_TOAST_TAB_OFFSET : 0),
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}>
              <VStack space="sm">
                <Text className="text-sm font-semibold text-card-foreground">
                  {t('watchSync.autoImportedTitle', { defaultValue: 'Watch log saved' })}
                </Text>
                <Text className="text-sm leading-5 text-muted-foreground">
                  {t('watchSync.autoImportedBody', {
                    defaultValue: 'A watch dive log was saved on this device.',
                  })}
                </Text>
                <HStack space="sm" className="pt-1">
                  <InstrumentButton
                    testID="watch-auto-import-open-log"
                    label={t('watchSync.openImportedLog', { defaultValue: 'Write log' })}
                    variant="primary"
                    onPress={openImportedLogToast}
                    className="min-h-10 flex-1 px-4 py-2"
                  />
                  <InstrumentButton
                    testID="watch-auto-import-dismiss"
                    label={t('watchSync.dismiss', { defaultValue: 'Close' })}
                    onPress={() => setAutoImportToast(undefined)}
                    className="min-h-10 flex-1 px-4 py-2"
                  />
                </HStack>
              </VStack>
            </Pressable>
          </Box>
        ) : null}
      </VStack>
    </WatchConnectivitySyncProvider>
  );
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

      <HStack className="bg-card px-2 pt-1" style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
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
    <RoutedScrollScreen>
      <LogEntryEditor
        entry={entry}
        mode="create"
        isSaving={props.logbook.isSaving}
        saveError={props.logbook.saveError}
        onCancel={() => props.navigation.goBack()}
        onSave={async nextEntry => {
          const savedEntry = await props.logbook.saveEntry(nextEntry);
          await props.onPendingDraftSaved(savedEntry, props.route.params?.sourcePlanLocalId);
          props.navigation.replace('logbookDetail', { localId: savedEntry.localId });
          return savedEntry;
        }}
      />
    </RoutedScrollScreen>
  );
}

function LogbookDetailRoute(
  props: NativeStackScreenProps<RootStackParamList, 'logbookDetail'> & {
    logbook: ReturnType<typeof useDiveLogbook>;
  },
): React.JSX.Element {
  const entry = props.logbook.entries.find(nextEntry => nextEntry.localId === props.route.params.localId);

  if (!entry) {
    return <MissingRouteScreen navigation={props.navigation} />;
  }

  return (
    <RoutedScrollScreen>
      <LogEntryDetail
        entry={entry}
        onBack={() => props.navigation.goBack()}
        onEdit={nextEntry => props.navigation.navigate('logbookEdit', { localId: nextEntry.localId })}
        onDelete={async localId => {
          await props.logbook.deleteEntry(localId);
          props.navigation.goBack();
        }}
      />
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
    return <MissingRouteScreen navigation={props.navigation} />;
  }

  return (
    <RoutedScrollScreen>
      <LogEntryEditor
        entry={entry}
        mode="edit"
        isSaving={props.logbook.isSaving}
        saveError={props.logbook.saveError}
        onCancel={() => props.navigation.goBack()}
        onSave={async nextEntry => {
          const savedEntry = await props.logbook.saveEntry(nextEntry);
          props.navigation.replace('logbookDetail', { localId: savedEntry.localId });
          return savedEntry;
        }}
      />
    </RoutedScrollScreen>
  );
}

function PlanningCreateRoute(
  props: NativeStackScreenProps<RootStackParamList, 'planningCreate'> & {
    planning: ReturnType<typeof useDivePlans>;
  },
): React.JSX.Element {
  const [plan] = React.useState(() => createBlankDivePlan());

  return (
    <RoutedScrollScreen>
      <PlanEditor
        plan={plan}
        mode="create"
        isSaving={props.planning.isSaving}
        saveError={props.planning.saveError}
        onCancel={() => props.navigation.goBack()}
        onSave={async nextPlan => {
          const savedPlan = await props.planning.savePlan(nextPlan);
          props.navigation.replace('planningDetail', { localId: savedPlan.localId });
          return savedPlan;
        }}
      />
    </RoutedScrollScreen>
  );
}

function PlanningDetailRoute(
  props: NativeStackScreenProps<RootStackParamList, 'planningDetail'> & {
    logbook: ReturnType<typeof useDiveLogbook>;
    planning: ReturnType<typeof useDivePlans>;
    onCreateLogFromPlan: (plan: DivePlan) => void;
    onPlanCompleted: (plan: DivePlan) => void;
  },
): React.JSX.Element {
  const plan = props.planning.plans.find(nextPlan => nextPlan.localId === props.route.params.localId);
  const hasExistingConvertedLog = Boolean(
    plan?.convertedLogLocalId && props.logbook.entries.some(entry => entry.localId === plan.convertedLogLocalId),
  );

  if (!plan) {
    return <MissingRouteScreen navigation={props.navigation} />;
  }

  return (
    <RoutedScrollScreen>
      <PlanDetail
        plan={plan}
        onBack={() => props.navigation.goBack()}
        onEdit={nextPlan => props.navigation.navigate('planningEdit', { localId: nextPlan.localId })}
        onPromote={async nextPlan => {
          if (!isPlanReadyForPromotion(nextPlan)) {
            props.navigation.navigate('planningEdit', { localId: nextPlan.localId });
            return;
          }

          const savedPlan = await props.planning.savePlan({
            ...nextPlan,
            status: 'planned',
            updatedAt: Date.now() / 1000,
          });
          props.navigation.replace('planningDetail', { localId: savedPlan.localId });
        }}
        onComplete={async nextPlan => {
          const timestamp = Date.now() / 1000;
          const savedPlan = await props.planning.savePlan({
            ...nextPlan,
            status: 'completed',
            completedAt: timestamp,
            updatedAt: timestamp,
          });
          props.onPlanCompleted(savedPlan);
        }}
        onDelete={async localId => {
          await props.planning.deletePlan(localId);
          props.navigation.goBack();
        }}
        onCreateLogFromPlan={props.onCreateLogFromPlan}
        hasExistingConvertedLog={hasExistingConvertedLog}
      />
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
    return <MissingRouteScreen navigation={props.navigation} />;
  }

  return (
    <RoutedScrollScreen>
      <PlanEditor
        plan={plan}
        mode="edit"
        isSaving={props.planning.isSaving}
        saveError={props.planning.saveError}
        onCancel={() => props.navigation.goBack()}
        onSave={async nextPlan => {
          const savedPlan = await props.planning.savePlan(nextPlan);
          props.navigation.replace('planningDetail', { localId: savedPlan.localId });
          return savedPlan;
        }}
      />
    </RoutedScrollScreen>
  );
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

function MissingRouteScreen(props: { navigation: NativeStackNavigationProp<RootStackParamList> }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <RoutedScrollScreen>
      <VStack testID="navigation-missing-route" space="md" className="rounded-2xl bg-card px-4 py-4">
        <Text className="text-lg font-semibold text-card-foreground">
          {t('navigation.missingRouteTitle', { defaultValue: 'Screen unavailable' })}
        </Text>
        <Text className="text-sm leading-5 text-muted-foreground">
          {t('navigation.missingRouteBody', { defaultValue: 'The item may have been deleted or is no longer available on this device.' })}
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

const navTabIndicatorStyles = tva({
  base: 'mb-1 h-0.5 w-5 rounded-full',
  variants: {
    selected: {
      true: 'bg-primary',
      false: 'bg-transparent',
    },
  },
  defaultVariants: {
    selected: false,
  },
});

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
  return (
    <Pressable
      onPress={props.onPress}
      testID={`nav-tab-${props.id}`}
      className={navTabStyles({ selected: props.selected })}
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.95 : 1 }] }]}>
      <Box className={navTabIndicatorStyles({ selected: props.selected })} />
      <Text className={navTabTextStyles({ selected: props.selected })}>{props.label}</Text>
    </Pressable>
  );
}
