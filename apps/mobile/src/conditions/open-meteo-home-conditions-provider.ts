import { openMeteoApiKey } from '../config/env';
import type { HomeConditionsInput, HomeConditionsProvider } from './home-conditions';

type OpenMeteoProviderOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
  now?: () => number;
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

export function createOpenMeteoHomeConditionsProvider(
  options: OpenMeteoProviderOptions = {},
): HomeConditionsProvider {
  const apiKey = options.apiKey ?? openMeteoApiKey;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => Date.now() / 1000);

  return {
    getCurrentConditions: async input => {
      if (input.latitude === undefined || input.longitude === undefined) {
        return { status: 'unavailable', source: 'openMeteo' };
      }

      try {
        const weather = await fetchJson<OpenMeteoWeatherResponse>(
          fetcher,
          buildWeatherUrl(input, apiKey),
        );
        const airTemperatureCelsius = weather.current?.temperature_2m;

        if (!isFiniteNumber(airTemperatureCelsius)) {
          return {
            status: 'error',
            source: 'openMeteo',
            errorMessage: 'Open-Meteo weather response did not include current temperature.',
          };
        }

        const marine = await fetchMarine(fetcher, buildMarineUrl(input, apiKey));
        const waterTemperatureCelsius = marine.ok ? marine.waterTemperatureCelsius : undefined;
        const timestamp = now();

        return {
          status: 'ready',
          cityName: formatTimezoneCity(weather.timezone),
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

async function fetchJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url);

  if (!response.ok) {
    throw new Error(`Open-Meteo request failed with HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchMarine(fetcher: typeof fetch, url: string): Promise<MarineFetchResult> {
  try {
    const marine = await fetchJson<OpenMeteoMarineResponse>(fetcher, url);
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
