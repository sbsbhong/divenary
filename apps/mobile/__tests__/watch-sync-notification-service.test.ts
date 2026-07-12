import { AppState, Platform } from 'react-native';
import {
  requestWatchSyncNotificationPermission,
  notifyWatchSyncImport,
  getInitialWatchSyncNotificationOpen,
  subscribeToWatchSyncNotificationOpens,
} from '../src/notifications/watch-sync-notification-service';
import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';
import notifee, { AuthorizationStatus, EventType } from '@notifee/react-native';

jest.mock('@notifee/react-native', () => {
  const mockNotifee = {
    createChannel: jest.fn(async () => 'watch-sync-imports'),
    displayNotification: jest.fn(async () => 'notification-id'),
    getInitialNotification: jest.fn(async () => null),
    getNotificationSettings: jest.fn(async () => ({ authorizationStatus: -1 })),
    onForegroundEvent: jest.fn(),
    requestPermission: jest.fn(async () => ({ authorizationStatus: 1 })),
  };

  return {
    __esModule: true,
    default: mockNotifee,
    AndroidImportance: { DEFAULT: 3 },
    AuthorizationStatus: {
      NOT_DETERMINED: -1,
      DENIED: 0,
      AUTHORIZED: 1,
      PROVISIONAL: 2,
    },
    EventType: {
      PRESS: 1,
    },
  };
});

const makeEntry = () => {
  const entry = createBlankDiveLogEntry({ localId: 'log-watch-1', now: 1781357600 });

  return {
    ...entry,
    source: 'watch' as const,
    syncStatus: 'synced' as const,
    manual: {
      ...entry.manual,
      title: 'Watch Reef',
      entryStyle: 'boat' as const,
      site: { name: 'Watch Reef' },
      measuredValues: {
        ...entry.manual.measuredValues,
        startedAt: 1781354000,
        durationSeconds: 2520,
        diveMode: 'scuba' as const,
        maxDepthMeters: 18,
      },
    },
    provenance: {
      ...entry.provenance,
      measuredValues: 'watch' as const,
    },
  };
};

describe('watch sync notification service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValue({
      authorizationStatus: AuthorizationStatus.NOT_DETERMINED,
    });
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
  });

  it('requests notification permission for Settings opt-in', async () => {
    (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
    });

    await expect(requestWatchSyncNotificationPermission()).resolves.toBe(true);
    expect(notifee.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('does not enable notifications when permission is denied', async () => {
    (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.DENIED,
    });

    await expect(requestWatchSyncNotificationPermission()).resolves.toBe(false);
  });

  it('does not request again after iOS has already denied permission', async () => {
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.DENIED,
    });

    await expect(requestWatchSyncNotificationPermission()).resolves.toBe(false);
    expect(notifee.requestPermission).not.toHaveBeenCalled();
  });

  it('displays the local-device watch import notification when enabled outside the foreground', async () => {
    await notifyWatchSyncImport(makeEntry(), { enabled: true, language: 'en' });

    expect(notifee.createChannel).toHaveBeenCalledWith({
      id: 'watch-sync-imports',
      name: 'Watch sync imports',
      importance: 3,
    });
    expect(notifee.displayNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Watch log saved',
      body: 'A watch dive log was saved on this device.',
      data: {
        entryLocalId: 'log-watch-1',
        locale: 'en',
        source: 'watch-sync-import',
      },
    }));
  });

  it('uses the app language preference for local notification copy and future push locale data', async () => {
    await notifyWatchSyncImport(makeEntry(), { enabled: true, language: 'ko' });

    expect(notifee.createChannel).toHaveBeenCalledWith({
      id: 'watch-sync-imports',
      name: '워치 기록 저장',
      importance: 3,
    });
    expect(notifee.displayNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: '워치 기록 저장됨',
      body: '워치 다이브 기록이 이 기기에 저장되었습니다.',
      data: {
        entryLocalId: 'log-watch-1',
        locale: 'ko',
        source: 'watch-sync-import',
      },
    }));
  });

  it('keeps foreground and disabled imports silent for local notifications', async () => {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });

    await notifyWatchSyncImport(makeEntry(), { enabled: true });
    await notifyWatchSyncImport(makeEntry(), { enabled: false });

    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });

  it('maps Notifee press events and bootstrap notification data to imported log ids', async () => {
    (notifee.getInitialNotification as jest.Mock).mockResolvedValueOnce({
      notification: {
        data: {
          entryLocalId: 'log-opened-from-launch',
          source: 'watch-sync-import',
        },
      },
    });
    const listener = jest.fn();
    const unsubscribe = jest.fn();
    (notifee.onForegroundEvent as jest.Mock).mockReturnValueOnce(unsubscribe);

    await expect(getInitialWatchSyncNotificationOpen()).resolves.toEqual({
      entryLocalId: 'log-opened-from-launch',
    });

    const subscription = subscribeToWatchSyncNotificationOpens(listener);
    const foregroundHandler = (notifee.onForegroundEvent as jest.Mock).mock.calls[0][0];
    foregroundHandler({
      type: EventType.PRESS,
      detail: {
        notification: {
          data: {
            entryLocalId: 'log-opened-from-press',
            source: 'watch-sync-import',
          },
        },
      },
    });

    expect(listener).toHaveBeenCalledWith({ entryLocalId: 'log-opened-from-press' });
    subscription.remove();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
