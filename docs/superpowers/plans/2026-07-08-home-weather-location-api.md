# Home Weather Location API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Home mock conditions path with default Home location permission, Open-Meteo weather/marine lookup, multilingual denied/error UX, and a development env key path.

**Architecture:** Keep Home screen rendering separate from platform and provider details. Add focused condition modules for env config, Open-Meteo normalization, foreground location lookup, and a controller hook that coordinates permission, retry, foreground refresh, and Home-facing actions.

**Tech Stack:** React Native 0.85, TypeScript, Jest, react-i18next, Open-Meteo Weather/Marine APIs, `@react-native-community/geolocation`, existing Gluestack/NativeWind UI primitives.

---

## File Structure

- Create: `apps/mobile/.env.development.example`
  - Documents `OPEN_METEO_API_KEY=` with an intentionally empty Debug default.
- Modify: `.gitignore`
  - Ignores local `.env.development` files while allowing example files.
- Modify: `apps/mobile/babel.config.js`
  - Reads `apps/mobile/.env.development` and injects the Open-Meteo key into a JS compile-time constant.
- Create: `apps/mobile/src/config/env.ts`
  - Exposes `openMeteoApiKey` without importing Node APIs in app runtime.
- Modify: `apps/mobile/package.json`, `yarn.lock`
  - Adds `@react-native-community/geolocation`.
- Create: `apps/mobile/src/conditions/open-meteo-home-conditions-provider.ts`
  - Owns Open-Meteo URL building, fetch calls, response parsing, and `HomeConditionsSnapshot` normalization.
- Create: `apps/mobile/src/conditions/location-service.ts`
  - Owns Android foreground permission and single current-position lookup.
- Create: `apps/mobile/src/conditions/use-home-conditions.ts`
  - Coordinates location, provider calls, retry, foreground refresh, and settings action.
- Modify: `apps/mobile/src/conditions/home-conditions.ts`
  - Keeps shared types and static test/mock provider helpers.
- Modify: `apps/mobile/src/screens/home/screen.tsx`
  - Uses `useHomeConditions` by default and renders denied/error action buttons.
- Modify: `apps/mobile/src/i18n/resources.ts`
  - Adds Korean/English copy for permission denied, settings, retry, API failure, attribution.
- Modify: `apps/mobile/ios/DiveMobile/Info.plist`
  - Fills `NSLocationWhenInUseUsageDescription`.
- Modify: `apps/mobile/android/app/src/main/AndroidManifest.xml`
  - Adds foreground coarse location permission.
- Test: `apps/mobile/__tests__/home-conditions-provider.test.ts`
  - Covers Open-Meteo URL, key, normalization, partial marine failure, and invalid responses.
- Test: `apps/mobile/__tests__/home-conditions-controller.test.tsx`
  - Covers controller success, denied, unavailable, retry, foreground refresh, and settings action.
- Modify: `apps/mobile/__tests__/home-conditions.test.tsx`
  - Updates Home UI tests for location-aware default state and multilingual denied/error copy.

---

### Task 1: Environment Config And Dependency

**Files:**
- Create: `apps/mobile/.env.development.example`
- Modify: `.gitignore`
- Modify: `apps/mobile/babel.config.js`
- Create: `apps/mobile/src/config/env.ts`
- Modify: `apps/mobile/package.json`
- Modify: `yarn.lock`

- [ ] **Step 1: Add geolocation dependency**

Run:

```bash
yarn workspace @repo/mobile add @react-native-community/geolocation
```

Expected: `apps/mobile/package.json` and `yarn.lock` update. If this fails with a registry/network sandbox error, rerun with escalation.

- [ ] **Step 2: Add env example and ignore local env**

Create `apps/mobile/.env.development.example`:

```env
OPEN_METEO_API_KEY=
```

Modify `.gitignore` by adding:

```gitignore
# Local mobile development environment
.env.development
```

- [ ] **Step 3: Inject Open-Meteo key at bundle time**

Modify `apps/mobile/babel.config.js` to:

```js
const fs = require('fs');
const path = require('path');

const loadDevelopmentEnv = () => {
  const envPath = path.resolve(__dirname, '.env.development');

  if (!fs.existsSync(envPath)) {
    return {};
  }

  return fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        return env;
      }

      const separatorIndex = trimmed.indexOf('=');

      if (separatorIndex === -1) {
        return env;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      env[key] = value.replace(/^["']|["']$/g, '');
      return env;
    }, {});
};

const env = loadDevelopmentEnv();

const inlineMobileEnvPlugin = ({ types: t }) => ({
  visitor: {
    Identifier(path) {
      if (path.node.name === '__OPEN_METEO_API_KEY__') {
        path.replaceWith(t.stringLiteral(env.OPEN_METEO_API_KEY ?? ''));
      }
    },
  },
});

module.exports = {
  presets: ['module:@react-native/babel-preset', 'nativewind/babel'],
  plugins: [
    '@babel/plugin-transform-class-static-block',
    [
      'module-resolver',
      {
        root: ['./'],
        alias: {
          '@': './src',
          'tailwind.config': './tailwind.config.js',
        },
      },
    ],
    inlineMobileEnvPlugin,
    'react-native-worklets/plugin',
  ],
};
```

- [ ] **Step 4: Add typed env module**

Create `apps/mobile/src/config/env.ts`:

```ts
declare const __OPEN_METEO_API_KEY__: string | undefined;

export const openMeteoApiKey = typeof __OPEN_METEO_API_KEY__ === 'string'
  ? __OPEN_METEO_API_KEY__
  : '';
```

- [ ] **Step 5: Verify env task**

Run:

```bash
yarn mobile:typecheck
```

Expected: TypeScript succeeds.

- [ ] **Step 6: Commit env task**

```bash
git add .gitignore apps/mobile/.env.development.example apps/mobile/babel.config.js apps/mobile/src/config/env.ts apps/mobile/package.json yarn.lock
git commit -m "feat: add mobile Open-Meteo env config"
```

---

### Task 2: Open-Meteo Provider

**Files:**
- Create: `apps/mobile/__tests__/home-conditions-provider.test.ts`
- Create: `apps/mobile/src/conditions/open-meteo-home-conditions-provider.ts`
- Modify: `apps/mobile/src/conditions/home-conditions.ts`

- [ ] **Step 1: Write provider tests**

Create `apps/mobile/__tests__/home-conditions-provider.test.ts`:

```ts
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

describe('Open-Meteo Home conditions provider', () => {
  it('uses free endpoints when the API key is empty', async () => {
    const fetcher = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(createJsonResponse(weatherResponse))
      .mockResolvedValueOnce(createJsonResponse(marineResponse));
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
    const fetcher = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(createJsonResponse(weatherResponse))
      .mockResolvedValueOnce(createJsonResponse(marineResponse));
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
    const fetcher = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(createJsonResponse(weatherResponse))
      .mockResolvedValueOnce(createJsonResponse(marineResponse));
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
    const fetcher = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(createJsonResponse(weatherResponse))
      .mockResolvedValueOnce(createJsonResponse({ reason: 'marine unavailable' }, false));
    const provider = createOpenMeteoHomeConditionsProvider({ fetcher, now: () => 1783512000 });

    await expect(provider.getCurrentConditions({ latitude: 33.5, longitude: 126.5 })).resolves.toMatchObject({
      status: 'ready',
      airTemperatureCelsius: 24.2,
      waterTemperatureCelsius: undefined,
      isCoastal: false,
    });
  });

  it('returns error when weather response is invalid', async () => {
    const fetcher = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValueOnce(createJsonResponse({ current: {} }));
    const provider = createOpenMeteoHomeConditionsProvider({ fetcher, now: () => 1783512000 });

    await expect(provider.getCurrentConditions({ latitude: 33.5, longitude: 126.5 })).resolves.toMatchObject({
      status: 'error',
      source: 'openMeteo',
    });
  });
});
```

- [ ] **Step 2: Run provider tests to verify they fail**

Run:

```bash
yarn workspace @repo/mobile test home-conditions-provider.test.ts
```

Expected: FAIL because `open-meteo-home-conditions-provider` does not exist.

- [ ] **Step 3: Implement provider**

Create `apps/mobile/src/conditions/open-meteo-home-conditions-provider.ts` with URL builders, response guards, and `createOpenMeteoHomeConditionsProvider`.

Implementation details:

```ts
import { openMeteoApiKey } from '../config/env';
import type { HomeConditionsInput, HomeConditionsProvider, HomeConditionsSnapshot } from './home-conditions';

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
        const temperature = weather.current?.temperature_2m;

        if (!isFiniteNumber(temperature)) {
          return {
            status: 'error',
            source: 'openMeteo',
            errorMessage: 'Open-Meteo weather response did not include current temperature.',
          };
        }

        const marine = await fetchMarine(fetcher, buildMarineUrl(input, apiKey));
        const waterTemperature = marine.ok ? marine.waterTemperatureCelsius : undefined;

        return {
          status: 'ready',
          cityName: formatTimezoneCity(weather.timezone),
          latitude: input.latitude,
          longitude: input.longitude,
          localTime: now(),
          airTemperatureCelsius: temperature,
          waterTemperatureCelsius: waterTemperature,
          isCoastal: waterTemperature !== undefined,
          source: 'openMeteo',
          updatedAt: now(),
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
```

- [ ] **Step 4: Run provider tests**

Run:

```bash
yarn workspace @repo/mobile test home-conditions-provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit provider task**

```bash
git add apps/mobile/__tests__/home-conditions-provider.test.ts apps/mobile/src/conditions/open-meteo-home-conditions-provider.ts apps/mobile/src/conditions/home-conditions.ts
git commit -m "feat: add Open-Meteo home conditions provider"
```

---

### Task 3: Location Service And Controller Hook

**Files:**
- Create: `apps/mobile/__tests__/home-conditions-controller.test.tsx`
- Create: `apps/mobile/src/conditions/location-service.ts`
- Create: `apps/mobile/src/conditions/use-home-conditions.ts`

- [ ] **Step 1: Write controller tests**

Create tests that inject fake location service, fake provider, and fake settings opener:

```ts
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppState } from 'react-native';
import { useHomeConditions } from '../src/conditions/use-home-conditions';
import type { HomeConditionsProvider } from '../src/conditions/home-conditions';
import type { LocationService } from '../src/conditions/location-service';

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function Harness(props: {
  locationService: LocationService;
  provider: HomeConditionsProvider;
  onSnapshot: jest.Mock;
  openSettings?: () => Promise<void>;
}) {
  const controller = useHomeConditions({
    locale: 'ko',
    locationService: props.locationService,
    conditionsProvider: props.provider,
    openSettings: props.openSettings,
  });

  React.useEffect(() => {
    props.onSnapshot(controller.snapshot);
  }, [controller.snapshot, props.onSnapshot]);

  return null;
}
```

Required cases:

- success calls provider with coordinates.
- denied returns `permissionDenied`.
- unavailable returns `unavailable`.
- retry reruns service/provider.
- foreground `active` event triggers one reload.
- `openSettings` calls injected settings opener.

- [ ] **Step 2: Run controller tests to verify they fail**

Run:

```bash
yarn workspace @repo/mobile test home-conditions-controller.test.tsx
```

Expected: FAIL because controller modules do not exist.

- [ ] **Step 3: Implement `location-service.ts`**

Create a service that:

- Requests `PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION` on Android.
- Uses `Geolocation.getCurrentPosition` with `enableHighAccuracy: false`, `timeout: 8000`, `maximumAge: 10 * 60 * 1000`.
- Maps permission denied to `permissionDenied`.
- Maps timeout/unavailable to `unavailable`.

- [ ] **Step 4: Implement `use-home-conditions.ts`**

Create a hook that:

- Starts in `{ status: 'loading' }`.
- Loads location, then provider snapshot.
- Exposes `retry` and `openSettings`.
- Uses `AppState.addEventListener('change', ...)` to reload on foreground active.
- Guards stale async requests with a request id ref.

- [ ] **Step 5: Run controller tests**

Run:

```bash
yarn workspace @repo/mobile test home-conditions-controller.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit controller task**

```bash
git add apps/mobile/__tests__/home-conditions-controller.test.tsx apps/mobile/src/conditions/location-service.ts apps/mobile/src/conditions/use-home-conditions.ts
git commit -m "feat: add home conditions location controller"
```

---

### Task 4: Home UI And Multilingual States

**Files:**
- Modify: `apps/mobile/src/screens/home/screen.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Modify: `apps/mobile/__tests__/home-conditions.test.tsx`

- [ ] **Step 1: Update Home UI tests**

Update `apps/mobile/__tests__/home-conditions.test.tsx` so each render injects both:

```ts
const locationService = {
  getCurrentLocation: jest.fn(async () => ({
    status: 'granted' as const,
    coordinates: {
      latitude: 33.5,
      longitude: 126.5,
      horizontalAccuracyMeters: 50,
      capturedAt: 1783512000,
    },
  })),
};
```

Add cases:

- Korean permission denied copy includes `위치 권한`.
- English permission denied copy includes `Location permission`.
- Denied state renders `home-conditions-open-settings-action` and `home-conditions-retry-action`.
- Retry button calls the controller retry path.
- Existing Logbook/Planning actions remain visible.

- [ ] **Step 2: Run Home tests to verify they fail**

Run:

```bash
yarn workspace @repo/mobile test home-conditions.test.tsx
```

Expected: FAIL because Home has not been wired to controller/i18n yet.

- [ ] **Step 3: Add i18n strings**

Add Korean and English keys under `home.conditions`:

```ts
permissionDenied: '위치 권한이 필요합니다.',
permissionDeniedBody: '위치 권한이 없어 현재 지역의 날씨, 기온, 수온 정보를 가져올 수 없습니다.',
openSettings: '설정 열기',
tryAgain: '다시 시도',
apiError: '날씨 정보를 가져오지 못했습니다.',
apiErrorBody: '잠시 후 다시 시도해 주세요. 로그북과 계획 기능은 계속 사용할 수 있습니다.',
attribution: 'Open-Meteo 데이터',
```

```ts
permissionDenied: 'Location permission needed',
permissionDeniedBody: 'Without location permission, DiveMobile cannot load weather, air temperature, or water temperature for your current area.',
openSettings: 'Open Settings',
tryAgain: 'Try Again',
apiError: 'Weather conditions unavailable',
apiErrorBody: 'Try again in a moment. Logbook and planning actions remain available.',
attribution: 'Open-Meteo data',
```

- [ ] **Step 4: Wire Home to controller**

Modify `HomeScreen` to:

- Default to `createOpenMeteoHomeConditionsProvider()`.
- Use `useHomeConditions({ locale, conditionsProvider, locationService })`.
- Pass `retry` and `openSettings` into `HomeConditionsBand`.
- Render permission-denied and error action buttons.

- [ ] **Step 5: Run Home tests**

Run:

```bash
yarn workspace @repo/mobile test home-conditions.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit UI task**

```bash
git add apps/mobile/src/screens/home/screen.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__/home-conditions.test.tsx
git commit -m "feat: show location-aware home condition states"
```

---

### Task 5: Native Permission Configuration

**Files:**
- Modify: `apps/mobile/ios/DiveMobile/Info.plist`
- Modify: `apps/mobile/android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Update iOS permission copy**

Set `NSLocationWhenInUseUsageDescription` to:

```xml
<string>DiveMobile uses your current location to show local weather, air temperature, and water temperature context.</string>
```

- [ ] **Step 2: Add Android coarse location permission**

Add to `apps/mobile/android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

- [ ] **Step 3: Run mobile typecheck**

Run:

```bash
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit native config**

```bash
git add apps/mobile/ios/DiveMobile/Info.plist apps/mobile/android/app/src/main/AndroidManifest.xml
git commit -m "feat: configure mobile location permission"
```

---

### Task 6: Final Verification And Handoff

**Files:**
- No new files unless a small doc/wiki update is required by repository policy after implementation.

- [ ] **Step 1: Run focused tests**

Run:

```bash
yarn workspace @repo/mobile test home-conditions-provider.test.ts home-conditions-controller.test.tsx home-conditions.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run mobile typecheck**

Run:

```bash
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 3: Try iOS build gate**

Run:

```bash
yarn ios:build
```

Expected: PASS if local CocoaPods/Xcode workspace is ready. If it fails because Pods/native workspace setup is missing, report that exact environment issue.

- [ ] **Step 4: Inspect branch status**

Run:

```bash
git status --short --branch
git log --oneline -6
```

Expected: branch is `feature/weather-location-api`; only intentional files are changed or committed.
