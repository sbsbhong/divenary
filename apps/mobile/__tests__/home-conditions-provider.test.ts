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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(nextResolve => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

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

  it('starts Weather, Marine, and reverse geocoding concurrently', async () => {
    const weather = createDeferred<Response>();
    const marine = createDeferred<Response>();
    const reverseGeocodeResult = createDeferred<{ cityName: string; locality: string }>();
    const fetcher = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockImplementation(request =>
        String(request).includes('/v1/forecast') ? weather.promise : marine.promise,
      );
    const reverseGeocode = jest.fn(() => reverseGeocodeResult.promise);
    const provider = createOpenMeteoHomeConditionsProvider({
      fetcher,
      reverseGeocode,
      now: () => 1783512000,
    });

    const conditions = provider.getCurrentConditions({
      latitude: 37.2636,
      longitude: 127.0286,
      locale: 'ko',
    });
    await flushMicrotasks();

    const startedUrls = fetcher.mock.calls.map(([request]) => String(request));
    const reverseGeocodeCallCount = reverseGeocode.mock.calls.length;

    weather.resolve(createJsonResponse(weatherResponse));
    marine.resolve(createJsonResponse(marineResponse));
    reverseGeocodeResult.resolve({ cityName: '수원시', locality: '수원시' });
    await conditions;

    expect(startedUrls.some(url => url.includes('/v1/forecast'))).toBe(true);
    expect(startedUrls.some(url => url.includes('/v1/marine'))).toBe(true);
    expect(reverseGeocodeCallCount).toBe(1);
  });

  it('uses reverse geocoded city before Open-Meteo timezone city', async () => {
    const fetcher = createFetcher(createJsonResponse(weatherResponse), createJsonResponse(marineResponse));
    const reverseGeocode = jest.fn(async () => ({ cityName: '수원시', locality: '수원시' }));
    const provider = createOpenMeteoHomeConditionsProvider({
      fetcher,
      reverseGeocode,
      now: () => 1783512000,
    });

    await expect(provider.getCurrentConditions({ latitude: 37.2636, longitude: 127.0286 })).resolves.toMatchObject({
      status: 'ready',
      cityName: '수원시',
    });
    expect(reverseGeocode).toHaveBeenCalledWith({ latitude: 37.2636, longitude: 127.0286 });
  });

  it('falls back to Open-Meteo timezone city when reverse geocoding fails', async () => {
    const fetcher = createFetcher(createJsonResponse(weatherResponse), createJsonResponse(marineResponse));
    const provider = createOpenMeteoHomeConditionsProvider({
      fetcher,
      reverseGeocode: async () => {
        throw new Error('reverse geocoder unavailable');
      },
      now: () => 1783512000,
    });

    await expect(provider.getCurrentConditions({ latitude: 33.5, longitude: 126.5 })).resolves.toMatchObject({
      status: 'ready',
      cityName: 'Seoul',
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

  it('returns ready air temperature when optional enrichment never settles', async () => {
    jest.useFakeTimers();

    try {
      const neverSettles = new Promise<Response>(() => {});
      let marineSignal: AbortSignal | undefined;
      const fetcher = jest
        .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
        .mockImplementation((request, init) => {
          if (String(request).includes('/v1/forecast')) {
            return Promise.resolve(createJsonResponse(weatherResponse));
          }

          marineSignal = init?.signal ?? undefined;
          return neverSettles;
        });
      const provider = createOpenMeteoHomeConditionsProvider({
        fetcher,
        reverseGeocode: () => new Promise(() => {}),
        now: () => 1783512000,
      });
      const conditions = provider.getCurrentConditions({
        latitude: 33.5,
        longitude: 126.5,
        locale: 'ko',
      });

      await flushMicrotasks();
      expect(marineSignal).toBeDefined();
      expect(marineSignal?.aborted).toBe(false);
      let settled = false;
      void conditions.finally(() => {
        settled = true;
      });

      await jest.advanceTimersByTimeAsync(2499);
      expect(settled).toBe(false);
      expect(marineSignal?.aborted).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      expect(marineSignal?.aborted).toBe(true);
      await expect(conditions).resolves.toMatchObject({
        status: 'ready',
        cityName: 'Seoul',
        airTemperatureCelsius: 24.2,
        isCoastal: false,
      });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns an error when required Weather work reaches its deadline twice', async () => {
    jest.useFakeTimers();

    try {
      const neverSettles = new Promise<Response>(() => {});
      let weatherSignal: AbortSignal | undefined;
      const fetcher = jest
        .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
        .mockImplementation((request, init) => {
          if (String(request).includes('/v1/forecast')) {
            weatherSignal = init?.signal ?? undefined;
            return neverSettles;
          }

          return Promise.resolve(createJsonResponse(marineResponse));
        });
      const provider = createOpenMeteoHomeConditionsProvider({
        fetcher,
        reverseGeocode: async () => ({ cityName: '제주시', locality: '제주시' }),
        now: () => 1783512000,
      });
      const conditions = provider.getCurrentConditions({
        latitude: 33.5,
        longitude: 126.5,
        locale: 'ko',
      });
      let settled = false;
      void conditions.finally(() => {
        settled = true;
      });

      await flushMicrotasks();
      expect(weatherSignal).toBeDefined();
      expect(weatherSignal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(7999);
      expect(settled).toBe(false);
      expect(weatherSignal?.aborted).toBe(false);

      const firstSignal = weatherSignal;
      await jest.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
      expect(firstSignal?.aborted).toBe(true);
      expect(settled).toBe(false);
      expect(weatherSignal).not.toBe(firstSignal);
      await jest.advanceTimersByTimeAsync(8000);
      expect(weatherSignal?.aborted).toBe(true);
      await expect(conditions).resolves.toMatchObject({
        status: 'error',
        source: 'openMeteo',
        errorMessage: 'Open-Meteo weather request timed out.',
      });
      expect(
        fetcher.mock.calls.filter(([request]) => String(request).includes('/v1/forecast')),
      ).toHaveLength(2);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries a failed Weather request once before reporting an error', async () => {
    let weatherCalls = 0;
    const fetcher = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockImplementation(request => {
        if (String(request).includes('/v1/forecast')) {
          weatherCalls += 1;
          return weatherCalls === 1
            ? Promise.reject(new Error('network lost'))
            : Promise.resolve(createJsonResponse(weatherResponse));
        }
        return Promise.resolve(createJsonResponse(marineResponse));
      });
    const provider = createOpenMeteoHomeConditionsProvider({
      fetcher,
      reverseGeocode: async () => undefined,
      now: () => 1783512000,
    });

    await expect(
      provider.getCurrentConditions({ latitude: 33.5, longitude: 126.5 }),
    ).resolves.toMatchObject({ status: 'ready' });
    expect(weatherCalls).toBe(2);
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
