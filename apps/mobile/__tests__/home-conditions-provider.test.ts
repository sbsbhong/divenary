import { createOpenMeteoHomeConditionsProvider } from '../src/conditions/open-meteo-home-conditions-provider';

const weatherResponse = {
  latitude: 33.5,
  longitude: 126.5,
  timezone: 'Asia/Seoul',
  current: {
    time: '2026-07-08T12:00',
    temperature_2m: 24.2,
  },
};

const marineResponse = {
  latitude: 33.5,
  longitude: 126.5,
  timezone: 'Asia/Seoul',
  current: {
    time: '2026-07-08T12:00',
    sea_surface_temperature: 22.8,
  },
};

const createJsonResponse = (body: unknown, ok = true): Response => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
} as Response);

const createFetcher = (...responses: Response[]) =>
  jest
    .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
    .mockImplementation(async () => {
      const next = responses.shift();

      if (!next) {
        throw new Error('Unexpected fetch call');
      }

      return next;
    });

describe('Open-Meteo Home conditions provider', () => {
  it('uses free endpoints when the API key is empty', async () => {
    const fetcher = createFetcher(createJsonResponse(weatherResponse), createJsonResponse(marineResponse));
    const provider = createOpenMeteoHomeConditionsProvider({
      apiKey: '',
      fetcher,
      now: () => 1783512000,
    });

    await provider.getCurrentConditions({ latitude: 33.5, longitude: 126.5, locale: 'ko' });

    const weatherUrl = String(fetcher.mock.calls[0][0]);
    const marineUrl = String(fetcher.mock.calls[1][0]);

    expect(weatherUrl).toContain('https://api.open-meteo.com/v1/forecast');
    expect(marineUrl).toContain('https://marine-api.open-meteo.com/v1/marine');
    expect(weatherUrl).not.toContain('apikey=');
    expect(marineUrl).not.toContain('apikey=');
  });

  it('uses customer endpoints and apikey when the API key is set', async () => {
    const fetcher = createFetcher(createJsonResponse(weatherResponse), createJsonResponse(marineResponse));
    const provider = createOpenMeteoHomeConditionsProvider({
      apiKey: 'paid-key',
      fetcher,
      now: () => 1783512000,
    });

    await provider.getCurrentConditions({ latitude: 33.5, longitude: 126.5, locale: 'en' });

    expect(String(fetcher.mock.calls[0][0])).toContain('https://customer-api.open-meteo.com/v1/forecast');
    expect(String(fetcher.mock.calls[0][0])).toContain('apikey=paid-key');
    expect(String(fetcher.mock.calls[1][0])).toContain('https://customer-marine-api.open-meteo.com/v1/marine');
    expect(String(fetcher.mock.calls[1][0])).toContain('apikey=paid-key');
  });

  it('returns air and water temperature when both APIs succeed', async () => {
    const fetcher = createFetcher(createJsonResponse(weatherResponse), createJsonResponse(marineResponse));
    const provider = createOpenMeteoHomeConditionsProvider({ fetcher, now: () => 1783512000 });

    await expect(provider.getCurrentConditions({ latitude: 33.5, longitude: 126.5 })).resolves.toMatchObject({
      status: 'ready',
      cityName: 'Seoul',
      latitude: 33.5,
      longitude: 126.5,
      airTemperatureCelsius: 24.2,
      waterTemperatureCelsius: 22.8,
      isCoastal: true,
      source: 'openMeteo',
      updatedAt: 1783512000,
    });
  });

  it('keeps air temperature ready when the Marine API fails', async () => {
    const fetcher = createFetcher(createJsonResponse(weatherResponse), createJsonResponse({ reason: 'marine unavailable' }, false));
    const provider = createOpenMeteoHomeConditionsProvider({ fetcher, now: () => 1783512000 });

    const snapshot = await provider.getCurrentConditions({ latitude: 33.5, longitude: 126.5 });

    expect(snapshot).toMatchObject({
      status: 'ready',
      airTemperatureCelsius: 24.2,
      isCoastal: false,
    });
    expect(snapshot.waterTemperatureCelsius).toBeUndefined();
  });

  it('returns error when weather response is invalid', async () => {
    const fetcher = createFetcher(createJsonResponse({ current: {} }));
    const provider = createOpenMeteoHomeConditionsProvider({ fetcher, now: () => 1783512000 });

    await expect(provider.getCurrentConditions({ latitude: 33.5, longitude: 126.5 })).resolves.toMatchObject({
      status: 'error',
      source: 'openMeteo',
    });
  });
});
