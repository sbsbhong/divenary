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

export const defaultLocationService: LocationService = {
  getCurrentLocation: async () => {
    const permission = await requestForegroundLocationPermission();

    if (permission.status !== 'granted') {
      return permission;
    }

    return getCurrentPosition();
  },
};

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

function getCurrentPosition(): Promise<LocationResult> {
  return new Promise(resolve => {
    Geolocation.getCurrentPosition(
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

function mapPositionError(error: GeolocationError): LocationResult {
  if (error.code === error.PERMISSION_DENIED || error.code === 1) {
    return { status: 'permissionDenied' };
  }

  return {
    status: 'unavailable',
    errorMessage: error.message,
  };
}
