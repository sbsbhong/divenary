import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  EventType,
  type Event,
  type InitialNotification,
  type Notification,
} from '@notifee/react-native';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import i18n, { resolveSupportedLanguage, type SupportedLanguage } from '../i18n';
import type { DiveLogEntry } from '../types/dive-log-entry';
import { createAsyncStorageKeyValueStore } from '../storage/persistent-key-value-store';

export type WatchSyncNotificationOpen = {
  entryLocalId: string;
};

type WatchSyncImportNotificationOptions = {
  enabled: boolean;
  appState?: AppStateStatus;
  language?: SupportedLanguage;
};

export const WATCH_SYNC_IMPORT_NOTIFICATION_CHANNEL_ID = 'watch-sync-imports';
const WATCH_SYNC_IMPORT_NOTIFICATION_SOURCE = 'watch-sync-import';
const BACKGROUND_OPEN_STORAGE_KEY = 'dive-mobile:watch-sync-notification-open';
const backgroundOpenStorage = createAsyncStorageKeyValueStore();

type WatchSyncImportNotificationContent = {
  body: string;
  channelName: string;
  locale: SupportedLanguage;
  title: string;
};

export async function requestWatchSyncNotificationPermission(): Promise<boolean> {
  try {
    if (typeof notifee.getNotificationSettings === 'function') {
      const currentSettings = await notifee.getNotificationSettings();
      if (isNotificationPermissionGranted(currentSettings.authorizationStatus)) {
        return true;
      }
      if (currentSettings.authorizationStatus === AuthorizationStatus.DENIED) {
        return false;
      }
    }
    const settings = await notifee.requestPermission();
    return isNotificationPermissionGranted(settings.authorizationStatus);
  } catch (error) {
    console.warn('Failed to request watch sync notification permission', error);
    return false;
  }
}

export async function hasWatchSyncNotificationPermission(): Promise<boolean> {
  try {
    if (typeof notifee.getNotificationSettings !== 'function') {
      return false;
    }
    const settings = await notifee.getNotificationSettings();
    return isNotificationPermissionGranted(settings.authorizationStatus);
  } catch {
    return false;
  }
}

function isNotificationPermissionGranted(status: AuthorizationStatus): boolean {
  return status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;
}

export async function notifyWatchSyncImport(
  entry: DiveLogEntry,
  options: WatchSyncImportNotificationOptions,
): Promise<void> {
  if (!options.enabled || (options.appState ?? AppState.currentState) === 'active') {
    return;
  }

  try {
    const content = resolveWatchSyncImportNotificationContent(options.language);
    const android =
      Platform.OS === 'android'
        ? {
            channelId: await ensureWatchSyncImportChannel(content.channelName),
            pressAction: {
              id: 'default',
            },
          }
        : undefined;

    await notifee.displayNotification({
      title: content.title,
      body: content.body,
      data: {
        entryLocalId: entry.localId,
        locale: content.locale,
        source: WATCH_SYNC_IMPORT_NOTIFICATION_SOURCE,
      },
      android,
      ios: {
        foregroundPresentationOptions: {
          alert: true,
          badge: false,
          sound: false,
        },
      },
    });
  } catch (error) {
    console.warn('Failed to display watch sync notification', error);
  }
}

export function resolveWatchSyncImportNotificationContent(
  language?: SupportedLanguage,
): WatchSyncImportNotificationContent {
  const locale = resolveSupportedLanguage(language ?? i18n.resolvedLanguage ?? i18n.language);

  return {
    body: i18n.t('watchSync.autoImportedBody', {
      defaultValue: 'A watch dive log was saved on this device.',
      lng: locale,
    }),
    channelName: i18n.t('watchSync.notificationChannelName', {
      defaultValue: 'Watch sync imports',
      lng: locale,
    }),
    locale,
    title: i18n.t('watchSync.autoImportedTitle', {
      defaultValue: 'Watch log saved',
      lng: locale,
    }),
  };
}

export async function getInitialWatchSyncNotificationOpen(): Promise<WatchSyncNotificationOpen | undefined> {
  try {
    const initialNotification = await notifee.getInitialNotification();
    const initialOpen = initialNotification ? notificationOpenFromInitialNotification(initialNotification) : undefined;
    if (initialOpen) {
      return initialOpen;
    }
    const storedOpen = await backgroundOpenStorage.getString(BACKGROUND_OPEN_STORAGE_KEY);
    if (!storedOpen) {
      return undefined;
    }
    await backgroundOpenStorage.remove(BACKGROUND_OPEN_STORAGE_KEY);
    return JSON.parse(storedOpen) as WatchSyncNotificationOpen;
  } catch (error) {
    console.warn('Failed to read initial watch sync notification', error);
    return undefined;
  }
}

export function subscribeToWatchSyncNotificationOpens(
  listener: (open: WatchSyncNotificationOpen) => void,
): { remove(): void } {
  const unsubscribe = notifee.onForegroundEvent((event: Event) => {
    if (event.type !== EventType.PRESS) {
      return;
    }

    const open = notificationOpenFromNotification(event.detail.notification);

    if (open) {
      listener(open);
    }
  });

  return {
    remove: unsubscribe,
  };
}

export function registerWatchSyncNotificationBackgroundHandler(): void {
  notifee.onBackgroundEvent(async (event: Event) => {
    if (event.type !== EventType.PRESS) {
      return;
    }
    const open = notificationOpenFromNotification(event.detail.notification);
    if (open) {
      await backgroundOpenStorage.setString(BACKGROUND_OPEN_STORAGE_KEY, JSON.stringify(open));
    }
  });
}

async function ensureWatchSyncImportChannel(channelName: string): Promise<string> {
  return notifee.createChannel({
    id: WATCH_SYNC_IMPORT_NOTIFICATION_CHANNEL_ID,
    name: channelName,
    importance: AndroidImportance.DEFAULT,
  });
}

function notificationOpenFromInitialNotification(
  initialNotification: InitialNotification,
): WatchSyncNotificationOpen | undefined {
  return notificationOpenFromNotification(initialNotification.notification);
}

function notificationOpenFromNotification(notification: Notification | undefined): WatchSyncNotificationOpen | undefined {
  const data = notification?.data;

  if (data?.source !== WATCH_SYNC_IMPORT_NOTIFICATION_SOURCE || typeof data.entryLocalId !== 'string') {
    return undefined;
  }

  return {
    entryLocalId: data.entryLocalId,
  };
}
