const mockStores = new Map<string, Map<string, string>>();
const mockAllStores = new Set<Map<string, string>>();

type AsyncStorageInstance = {
  getItem: jest.Mock<Promise<string | null>, [string]>;
  setItem: jest.Mock<Promise<void>, [string, string]>;
  removeItem: jest.Mock<Promise<void>, [string]>;
  clear: jest.Mock<Promise<void>, []>;
};

const mockGetStore = (databaseName: string): Map<string, string> => {
  const current = mockStores.get(databaseName);

  if (current) {
    return current;
  }

  const next = new Map<string, string>();
  mockAllStores.add(next);
  mockStores.set(databaseName, next);
  return next;
};

jest.mock('@react-native-async-storage/async-storage', () => {
  const createAsyncStorage = (databaseName = 'default'): AsyncStorageInstance => {
    const store = mockGetStore(databaseName);

    return {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      clear: jest.fn(async () => {
        store.clear();
      }),
    };
  };

  return {
    createAsyncStorage,
    __resetAsyncStorageMock: () => {
      for (const store of mockAllStores.values()) {
        store.clear();
      }
      mockStores.clear();
    },
  };
});

jest.mock('@notifee/react-native', () => {
  const notifee = {
    createChannel: jest.fn(async () => 'watch-sync-imports'),
    displayNotification: jest.fn(async () => 'notification-id'),
    getInitialNotification: jest.fn(async () => null),
    onForegroundEvent: jest.fn(() => jest.fn()),
    requestPermission: jest.fn(async () => ({ authorizationStatus: 1 })),
  };

  return {
    __esModule: true,
    default: notifee,
    AndroidImportance: {
      DEFAULT: 3,
    },
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

jest.mock('@react-native-community/geolocation', () => {
  const geolocation = {
    getCurrentPosition: jest.fn(),
    requestAuthorization: jest.fn(),
    setRNConfiguration: jest.fn(),
    watchPosition: jest.fn(() => 1),
    clearWatch: jest.fn(),
    stopObserving: jest.fn(),
  };

  return {
    __esModule: true,
    default: geolocation,
  };
});

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    signIn: jest.fn(),
  },
  GoogleSigninButton: 'GoogleSigninButton',
  isCancelledResponse: (response: {type?: string}) =>
    response.type === 'cancelled',
  isSuccessResponse: (response: {type?: string}) => response.type === 'success',
}));

jest.mock('@invertase/react-native-apple-authentication', () => {
  const appleAuth = {
    isSupported: false,
    performRequest: jest.fn(),
    Error: {CANCELED: '1001'},
    Operation: {LOGIN: 1},
    Scope: {EMAIL: 0, FULL_NAME: 1},
  };

  return {
    __esModule: true,
    appleAuth,
    default: appleAuth,
    AppleButton: 'AppleButton',
  };
});

// Reanimated's own mock runs animations to their end state at once, so tests read final values.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
