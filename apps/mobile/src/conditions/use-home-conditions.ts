import React from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import type { HomeConditionsProvider, HomeConditionsSnapshot } from './home-conditions';
import { defaultLocationService, type LocationService } from './location-service';

type UseHomeConditionsOptions = {
  locale: string;
  conditionsProvider: HomeConditionsProvider;
  locationService?: LocationService;
  openSettings?: () => Promise<void>;
};

export type HomeConditionsController = {
  snapshot: HomeConditionsSnapshot;
  isRefreshing: boolean;
  retry: () => void;
  openSettings: () => Promise<void>;
};

type ReadyHomeConditionsSnapshot = HomeConditionsSnapshot & { status: 'ready' };

type CachedReadyConditions = {
  cachedAtMs: number;
  snapshot: ReadyHomeConditionsSnapshot;
};

type HomeConditionsRequest = {
  locale: string;
  locationService: LocationService;
  conditionsProvider: HomeConditionsProvider;
};

const HOME_CONDITIONS_CACHE_TTL_MS = 5 * 60 * 1000;
const readyConditionsByLocale = new Map<string, CachedReadyConditions>();
const inFlightConditionsByLocale = new Map<string, Promise<HomeConditionsSnapshot>>();

export function resetHomeConditionsCacheForTests(): void {
  readyConditionsByLocale.clear();
  inFlightConditionsByLocale.clear();
}

export function useHomeConditions(options: UseHomeConditionsOptions): HomeConditionsController {
  const locationService = options.locationService ?? defaultLocationService;
  const openSettings = options.openSettings ?? defaultOpenSettings;
  const [snapshot, setSnapshot] = React.useState<HomeConditionsSnapshot>(
    () => getFreshReadyConditions(options.locale) ?? { status: 'loading' },
  );
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const snapshotRef = React.useRef(snapshot);
  const isMounted = React.useRef(true);
  const requestId = React.useRef(0);

  const updateSnapshot = React.useCallback((nextSnapshot: HomeConditionsSnapshot) => {
    snapshotRef.current = nextSnapshot;

    if (isMounted.current) {
      setSnapshot(nextSnapshot);
    }
  }, []);

  const updateRefreshing = React.useCallback((nextIsRefreshing: boolean) => {
    if (isMounted.current) {
      setIsRefreshing(nextIsRefreshing);
    }
  }, []);

  const loadConditions = React.useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    const hasInFlightRequest = inFlightConditionsByLocale.has(options.locale);
    const cachedSnapshot = mode === 'initial' && !hasInFlightRequest
      ? getFreshReadyConditions(options.locale)
      : undefined;

    if (cachedSnapshot) {
      updateSnapshot(cachedSnapshot);
      updateRefreshing(false);
      return;
    }

    const shouldKeepReadySnapshot = snapshotRef.current.status === 'ready'
      && (mode === 'refresh' || hasInFlightRequest);

    if (shouldKeepReadySnapshot) {
      updateRefreshing(true);
    } else {
      updateSnapshot({ status: 'loading' });
    }

    try {
      const nextSnapshot = await getOrCreateConditionsRequest({
        locale: options.locale,
        locationService,
        conditionsProvider: options.conditionsProvider,
      });

      if (!isMounted.current || requestId.current !== currentRequestId) {
        return;
      }

      updateSnapshot(nextSnapshot);
    } catch (error) {
      if (isMounted.current && requestId.current === currentRequestId) {
        updateSnapshot({
          status: 'error',
          source: 'openMeteo',
          errorMessage: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      if (isMounted.current && requestId.current === currentRequestId) {
        updateRefreshing(false);
      }
    }
  }, [
    locationService,
    options.conditionsProvider,
    options.locale,
    updateRefreshing,
    updateSnapshot,
  ]);

  React.useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
      requestId.current += 1;
    };
  }, []);

  React.useEffect(() => {
    if (AppState.currentState === 'active') {
      void loadConditions();
    }
  }, [loadConditions]);

  React.useEffect(() => {
    const previousState = { current: AppState.currentState as AppStateStatus };
    const subscription = AppState.addEventListener('change', nextState => {
      const wasActive = previousState.current === 'active';
      previousState.current = nextState;

      if (nextState === 'active' && !wasActive) {
        void loadConditions();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [loadConditions]);

  const retry = React.useCallback(() => {
    void loadConditions('refresh');
  }, [loadConditions]);

  return {
    snapshot,
    isRefreshing,
    retry,
    openSettings,
  };
}

function getFreshReadyConditions(locale: string): ReadyHomeConditionsSnapshot | undefined {
  const cached = readyConditionsByLocale.get(locale);

  if (!cached) {
    return undefined;
  }

  if (Date.now() - cached.cachedAtMs >= HOME_CONDITIONS_CACHE_TTL_MS) {
    readyConditionsByLocale.delete(locale);
    return undefined;
  }

  return cached.snapshot;
}

function getOrCreateConditionsRequest(request: HomeConditionsRequest): Promise<HomeConditionsSnapshot> {
  const existingRequest = inFlightConditionsByLocale.get(request.locale);

  if (existingRequest) {
    return existingRequest;
  }

  const nextRequest = requestCurrentConditions(request)
    .then(snapshot => {
      if (isReadyHomeConditionsSnapshot(snapshot)) {
        readyConditionsByLocale.set(request.locale, {
          cachedAtMs: Date.now(),
          snapshot,
        });
      }

      return snapshot;
    })
    .finally(() => {
      if (inFlightConditionsByLocale.get(request.locale) === nextRequest) {
        inFlightConditionsByLocale.delete(request.locale);
      }
    });

  inFlightConditionsByLocale.set(request.locale, nextRequest);
  return nextRequest;
}

function isReadyHomeConditionsSnapshot(
  snapshot: HomeConditionsSnapshot,
): snapshot is ReadyHomeConditionsSnapshot {
  return snapshot.status === 'ready';
}

async function requestCurrentConditions(
  request: HomeConditionsRequest,
): Promise<HomeConditionsSnapshot> {
  const location = await request.locationService.getCurrentLocation();

  if (location.status === 'permissionDenied') {
    return { status: 'permissionDenied', source: 'openMeteo' };
  }

  if (location.status === 'unavailable') {
    return {
      status: 'unavailable',
      source: 'openMeteo',
      errorMessage: location.errorMessage,
    };
  }

  return request.conditionsProvider.getCurrentConditions({
    latitude: location.coordinates.latitude,
    longitude: location.coordinates.longitude,
    locale: request.locale,
  });
}

async function defaultOpenSettings(): Promise<void> {
  await Linking.openSettings();
}
