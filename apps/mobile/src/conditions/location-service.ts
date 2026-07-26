import Geolocation, { type GeolocationError, type GeolocationResponse } from '@react-native-community/geolocation';
import { PermissionsAndroid, Platform } from 'react-native';

export type LocationCoordinates = {
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters?: number;
  capturedAt: number;
};

export type LocationResult =
  | { status: 'granted'; coordinates: LocationCoordinates }
  | { status: 'permissionDenied' }
  | { status: 'unavailable'; errorMessage?: string };

export type LocationService = {
  getCurrentLocation(): Promise<LocationResult>;
};

export type LocationServiceFactoryOptions = {
  getCurrentPosition: typeof Geolocation.getCurrentPosition;
  wait?: (milliseconds: number) => Promise<void>;
};

type CurrentPositionResult = LocationResult | {
  status: 'transientUnavailable';
  errorMessage?: string;
};

const TRANSIENT_RETRY_DELAYS_MS = [250, 750] as const;
const POSITION_UNAVAILABLE = 2;

const currentPositionOptions = {
  enableHighAccuracy: false,
  timeout: 8000,
  maximumAge: 10 * 60 * 1000,
};

Geolocation.setRNConfiguration({
  skipPermissionRequests: false,
  authorizationLevel: 'whenInUse',
  enableBackgroundLocationUpdates: false,
  locationProvider: 'auto',
});

export const defaultLocationService = createLocationService({
  getCurrentPosition: Geolocation.getCurrentPosition,
});

export function createLocationService(options: LocationServiceFactoryOptions): LocationService {
  const wait = options.wait ?? defaultWait;

  return {
    getCurrentLocation: async () => {
      const permission = await requestForegroundLocationPermission();

      if (permission.status !== 'granted') {
        return permission;
      }

      for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
        const result = await requestCurrentPosition(options.getCurrentPosition);

        if (result.status !== 'transientUnavailable') {
          return result;
        }

        const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];

        if (delay === undefined) {
          return {
            status: 'unavailable',
            errorMessage: result.errorMessage,
          };
        }

        await wait(delay);
      }

      return { status: 'unavailable' };
    },
  };
}

async function requestForegroundLocationPermission(): Promise<LocationResult | { status: 'granted' }> {
  if (Platform.OS !== 'android') {
    return { status: 'granted' };
  }

  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
  const result = await PermissionsAndroid.request(permission);

  return result === PermissionsAndroid.RESULTS.GRANTED
    ? { status: 'granted' }
    : { status: 'permissionDenied' };
}

function requestCurrentPosition(
  getCurrentPosition: typeof Geolocation.getCurrentPosition,
): Promise<CurrentPositionResult> {
  return new Promise(resolve => {
    getCurrentPosition(
      position => resolve(mapPosition(position)),
      error => resolve(mapPositionError(error)),
      currentPositionOptions,
    );
  });
}

function mapPosition(position: GeolocationResponse): LocationResult {
  return {
    status: 'granted',
    coordinates: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      horizontalAccuracyMeters: position.coords.accuracy,
      capturedAt: position.timestamp / 1000,
    },
  };
}

function mapPositionError(error: GeolocationError): CurrentPositionResult {
  if (error.code === 1) {
    return { status: 'permissionDenied' };
  }

  if (error.code === POSITION_UNAVAILABLE) {
    return {
      status: 'transientUnavailable',
      errorMessage: error.message,
    };
  }

  return {
    status: 'unavailable',
    errorMessage: error.message,
  };
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}
