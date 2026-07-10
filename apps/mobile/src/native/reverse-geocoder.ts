import { NativeModules } from 'react-native';

export type ReverseGeocodedPlace = {
  cityName?: string;
  locality?: string;
  subAdministrativeArea?: string;
  administrativeArea?: string;
  country?: string;
};

export type ReverseGeocodeCoordinatesInput = {
  latitude: number;
  longitude: number;
  locale?: string;
};

type ReverseGeocoderNativeModule = {
  reverseGeocode: (
    latitude: number,
    longitude: number,
    locale: string | null,
  ) => Promise<ReverseGeocodedPlace | null | undefined>;
};

const nativeModule = NativeModules.ReverseGeocoderModule as ReverseGeocoderNativeModule | undefined;

export function isReverseGeocoderAvailable(): boolean {
  return Boolean(nativeModule?.reverseGeocode);
}

export async function reverseGeocodeCoordinates(
  input: ReverseGeocodeCoordinatesInput,
): Promise<ReverseGeocodedPlace | undefined> {
  if (!nativeModule?.reverseGeocode) {
    return undefined;
  }

  const place = await nativeModule.reverseGeocode(input.latitude, input.longitude, input.locale ?? null);

  return normalizePlace(place);
}

export function formatReverseGeocodedCity(place: ReverseGeocodedPlace | undefined): string | undefined {
  return firstNonBlank(place?.cityName, place?.locality, place?.subAdministrativeArea, place?.administrativeArea);
}

function normalizePlace(place: ReverseGeocodedPlace | null | undefined): ReverseGeocodedPlace | undefined {
  if (!place) {
    return undefined;
  }

  const normalizedPlace = {
    locality: nonBlankString(place.locality),
    subAdministrativeArea: nonBlankString(place.subAdministrativeArea),
    administrativeArea: nonBlankString(place.administrativeArea),
    country: nonBlankString(place.country),
  };
  const cityName = firstNonBlank(place.cityName, normalizedPlace.locality, normalizedPlace.subAdministrativeArea, normalizedPlace.administrativeArea);

  if (!cityName && !normalizedPlace.country) {
    return undefined;
  }

  return {
    ...normalizedPlace,
    cityName,
  };
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalizedValue = nonBlankString(value);

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return undefined;
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
