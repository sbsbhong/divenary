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
  retry: () => void;
  openSettings: () => Promise<void>;
};

export function useHomeConditions(options: UseHomeConditionsOptions): HomeConditionsController {
  const locationService = options.locationService ?? defaultLocationService;
  const openSettings = options.openSettings ?? defaultOpenSettings;
  const [snapshot, setSnapshot] = React.useState<HomeConditionsSnapshot>({ status: 'loading' });
  const requestId = React.useRef(0);

  const loadConditions = React.useCallback(async () => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setSnapshot({ status: 'loading' });

    const location = await locationService.getCurrentLocation();

    if (requestId.current !== currentRequestId) {
      return;
    }

    if (location.status === 'permissionDenied') {
      setSnapshot({ status: 'permissionDenied', source: 'openMeteo' });
      return;
    }

    if (location.status === 'unavailable') {
      setSnapshot({
        status: 'unavailable',
        source: 'openMeteo',
        errorMessage: location.errorMessage,
      });
      return;
    }

    try {
      const nextSnapshot = await options.conditionsProvider.getCurrentConditions({
        latitude: location.coordinates.latitude,
        longitude: location.coordinates.longitude,
        locale: options.locale,
      });

      if (requestId.current === currentRequestId) {
        setSnapshot(nextSnapshot);
      }
    } catch (error) {
      if (requestId.current === currentRequestId) {
        setSnapshot({
          status: 'error',
          source: 'openMeteo',
          errorMessage: error instanceof Error ? error.message : undefined,
        });
      }
    }
  }, [locationService, options.conditionsProvider, options.locale]);

  React.useEffect(() => {
    void loadConditions();
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
    void loadConditions();
  }, [loadConditions]);

  return {
    snapshot,
    retry,
    openSettings,
  };
}

async function defaultOpenSettings(): Promise<void> {
  await Linking.openSettings();
}
