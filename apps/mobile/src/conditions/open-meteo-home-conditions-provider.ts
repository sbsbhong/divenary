import { openMeteoApiKey } from '../config/env';
import {
  formatReverseGeocodedCity,
  reverseGeocodeCoordinates,
  type ReverseGeocodedPlace,
  type ReverseGeocodeCoordinatesInput,
} from '../native/reverse-geocoder';
import type { HomeConditionsInput, HomeConditionsProvider } from './home-conditions';

type OpenMeteoProviderOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  reverseGeocode?: (input: ReverseGeocodeCoordinatesInput) => Promise<ReverseGeocodedPlace | undefined>;
};

type OpenMeteoWeatherResponse = {
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
  };
};

type OpenMeteoMarineResponse = {
  current?: {
    sea_surface_temperature?: number;
  };
};

type MarineFetchResult =
  | { ok: true; waterTemperatureCelsius: number }
  | { ok: false };

const freeWeatherBaseUrl = 'https://api.open-meteo.com/v1/forecast';
const customerWeatherBaseUrl = 'https://customer-api.open-meteo.com/v1/forecast';
const freeMarineBaseUrl = 'https://marine-api.open-meteo.com/v1/marine';
const customerMarineBaseUrl = 'https://customer-marine-api.open-meteo.com/v1/marine';
const weatherRequestTimeoutMs = 8000;
const optionalEnrichmentTimeoutMs = 2500;

export function createOpenMeteoHomeConditionsProvider(
  options: OpenMeteoProviderOptions = {},
): HomeConditionsProvider {
  const apiKey = options.apiKey ?? openMeteoApiKey;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => Date.now() / 1000);
  const reverseGeocode = options.reverseGeocode ?? reverseGeocodeCoordinates;

  return {
    getCurrentConditions: async input => {
      if (input.latitude === undefined || input.longitude === undefined) {
        return { status: 'unavailable', source: 'openMeteo' };
      }

      try {
        // The deadline is a JS timer. When the JS thread stalls, it can fire before an already
        // finished response is delivered, so a failed or timed-out request is tried once more.
        const weatherRequest = retryOnce(() =>
          rejectOnAbortableTimeout(
            signal => fetchJson<OpenMeteoWeatherResponse>(
              fetcher,
              buildWeatherUrl(input, apiKey),
              signal,
            ),
            weatherRequestTimeoutMs,
            'Open-Meteo weather request timed out.',
          ),
        );
        const marineRequest = fallbackOnAbortableTimeout(
          signal => fetchMarine(fetcher, buildMarineUrl(input, apiKey), signal),
          optionalEnrichmentTimeoutMs,
          { ok: false } as const,
        );
        const reverseGeocodeRequest = fallbackOnTimeout(
          fetchReverseGeocodedPlace(reverseGeocode, input),
          optionalEnrichmentTimeoutMs,
          undefined,
        );
        const weather = await weatherRequest;
        const airTemperatureCelsius = weather.current?.temperature_2m;

        if (!isFiniteNumber(airTemperatureCelsius)) {
          return {
            status: 'error',
            source: 'openMeteo',
            errorMessage: 'Open-Meteo weather response did not include current temperature.',
          };
        }

        const [marine, reverseGeocodedPlace] = await Promise.all([
          marineRequest,
          reverseGeocodeRequest,
        ]);
        const waterTemperatureCelsius = marine.ok ? marine.waterTemperatureCelsius : undefined;
        const timestamp = now();

        return {
          status: 'ready',
          cityName: formatReverseGeocodedCity(reverseGeocodedPlace) ?? formatTimezoneCity(weather.timezone),
          latitude: input.latitude,
          longitude: input.longitude,
          localTime: timestamp,
          airTemperatureCelsius,
          waterTemperatureCelsius,
          isCoastal: waterTemperatureCelsius !== undefined,
          source: 'openMeteo',
          updatedAt: timestamp,
        };
      } catch (error) {
        return {
          status: 'error',
          source: 'openMeteo',
          errorMessage: error instanceof Error ? error.message : undefined,
        };
      }
    },
  };
}

async function retryOnce<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    return operation();
  }
}

function rejectOnAbortableTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([operation(controller.signal), deadline]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}

function fallbackOnTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>(resolve => {
    timeout = setTimeout(() => resolve(fallback), timeoutMs);
  });

  return Promise.race([operation, deadline]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}

function fallbackOnAbortableTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>(resolve => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, timeoutMs);
  });

  return Promise.race([operation(controller.signal), deadline]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}

async function fetchReverseGeocodedPlace(
  reverseGeocode: (input: ReverseGeocodeCoordinatesInput) => Promise<ReverseGeocodedPlace | undefined>,
  input: HomeConditionsInput,
): Promise<ReverseGeocodedPlace | undefined> {
  if (input.latitude === undefined || input.longitude === undefined) {
    return undefined;
  }

  try {
    return await reverseGeocode({
      latitude: input.latitude,
      longitude: input.longitude,
      ...(input.locale ? { locale: input.locale } : {}),
    });
  } catch {
    return undefined;
  }
}

async function fetchJson<T>(
  fetcher: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = signal
    ? await fetcher(url, { signal })
    : await fetcher(url);

  if (!response.ok) {
    throw new Error(`Open-Meteo request failed with HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchMarine(
  fetcher: typeof fetch,
  url: string,
  signal: AbortSignal,
): Promise<MarineFetchResult> {
  try {
    const marine = await fetchJson<OpenMeteoMarineResponse>(fetcher, url, signal);
    const waterTemperatureCelsius = marine.current?.sea_surface_temperature;

    return isFiniteNumber(waterTemperatureCelsius)
      ? { ok: true, waterTemperatureCelsius }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

function buildWeatherUrl(input: HomeConditionsInput, apiKey: string): string {
  const baseUrl = apiKey ? customerWeatherBaseUrl : freeWeatherBaseUrl;
  const params = new URLSearchParams({
    latitude: String(input.latitude),
    longitude: String(input.longitude),
    current: 'temperature_2m',
    temperature_unit: 'celsius',
    timezone: 'auto',
    forecast_days: '1',
  });

  if (apiKey) {
    params.set('apikey', apiKey);
  }

  return `${baseUrl}?${params.toString()}`;
}

function buildMarineUrl(input: HomeConditionsInput, apiKey: string): string {
  const baseUrl = apiKey ? customerMarineBaseUrl : freeMarineBaseUrl;
  const params = new URLSearchParams({
    latitude: String(input.latitude),
    longitude: String(input.longitude),
    current: 'sea_surface_temperature',
    timezone: 'auto',
    cell_selection: 'sea',
    forecast_days: '1',
  });

  if (apiKey) {
    params.set('apikey', apiKey);
  }

  return `${baseUrl}?${params.toString()}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatTimezoneCity(timezone: string | undefined): string | undefined {
  if (!timezone) {
    return undefined;
  }

  const city = timezone.split('/').pop();

  return city ? city.replace(/_/g, ' ') : undefined;
}
