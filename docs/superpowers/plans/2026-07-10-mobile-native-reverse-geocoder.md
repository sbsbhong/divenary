# Mobile Native Reverse Geocoder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the user's actual city, such as `수원시`, on Home conditions by resolving granted device coordinates through repo-local iOS and Android reverse geocoder modules.

**Architecture:** Keep `@react-native-community/geolocation` as the coordinate provider and add a small repo-local native module for reverse geocoding. The Open-Meteo provider still owns weather and marine data, but it asks the native reverse geocoder for display city and falls back to Open-Meteo timezone city when the native module is unavailable or fails.

**Tech Stack:** React Native 0.85.3, TypeScript, Jest, iOS `CLGeocoder`, Android `android.location.Geocoder`, Xcode project target membership, Karpathy LLM Wiki.

---

### Task 1: Provider Behavior Tests

**Files:**
- Modify: `apps/mobile/__tests__/home-conditions-provider.test.ts`
- Modify: `apps/mobile/src/conditions/open-meteo-home-conditions-provider.ts`

- [ ] **Step 1: Write the failing tests**

Add tests proving that the Open-Meteo provider prefers the native reverse-geocoded city and falls back to timezone city if the reverse geocoder fails.

```ts
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
```

- [ ] **Step 2: Verify RED**

Run:

```bash
yarn workspace @repo/mobile test --watchman=false __tests__/home-conditions-provider.test.ts
```

Expected: fail because `OpenMeteoProviderOptions` does not accept `reverseGeocode` and the provider always formats timezone city.

- [ ] **Step 3: Implement provider integration**

Add a `reverseGeocode` option, import the native wrapper, resolve city name after weather fetch succeeds, and catch reverse geocoder failures locally.

- [ ] **Step 4: Verify GREEN**

Run the same focused Jest command. Expected: all tests in `home-conditions-provider.test.ts` pass.

### Task 2: Native Reverse Geocoder Wrapper And Source Tests

**Files:**
- Create: `apps/mobile/src/native/reverse-geocoder.ts`
- Create: `apps/mobile/__tests__/reverse-geocoder-native-source.test.ts`
- Create: `apps/mobile/ios/DiveMobile/ReverseGeocoderModule.swift`
- Create: `apps/mobile/ios/DiveMobile/ReverseGeocoderModuleBridge.m`
- Modify: `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
- Create: `apps/mobile/android/app/src/main/java/com/divemobile/ReverseGeocoderModule.kt`
- Create: `apps/mobile/android/app/src/main/java/com/divemobile/ReverseGeocoderPackage.kt`
- Modify: `apps/mobile/android/app/src/main/java/com/divemobile/MainApplication.kt`

- [ ] **Step 1: Write the failing native source tests**

Add a Jest source test that reads the iOS, Android, and Xcode project files and asserts the module uses `CLGeocoder`/`Geocoder`, exposes `ReverseGeocoderModule`, returns locality fields, and is registered in iOS/Android target/package lists.

- [ ] **Step 2: Verify RED**

Run:

```bash
yarn workspace @repo/mobile test --watchman=false __tests__/reverse-geocoder-native-source.test.ts
```

Expected: fail because the native module source files do not exist yet.

- [ ] **Step 3: Implement wrapper and native modules**

The JS wrapper should expose:

```ts
export type ReverseGeocodedPlace = {
  cityName?: string;
  locality?: string;
  subAdministrativeArea?: string;
  administrativeArea?: string;
  country?: string;
};
```

The iOS module should call `CLGeocoder().reverseGeocodeLocation` and resolve an object whose `cityName` prefers `locality`, then `subAdministrativeArea`, then `administrativeArea`.

The Android module should call `android.location.Geocoder` off the JS thread and return a `WritableMap` with the same field names. `MainApplication.kt` should add `ReverseGeocoderPackage()`.

- [ ] **Step 4: Verify GREEN**

Run both focused Jest tests. Expected: provider behavior and native source registration tests pass.

### Task 3: Wiki Update

**Files:**
- Create: `.wiki/raw/architecture/2026-07-10-mobile-native-reverse-geocoder.md`
- Modify: `.wiki/wiki/architecture/mobile.md`
- Modify: `.wiki/wiki/architecture/implementation-priorities.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

- [ ] **Step 1: Capture raw source**

Record the accepted implementation decision and source paths in `.wiki/raw/architecture/2026-07-10-mobile-native-reverse-geocoder.md`.

- [ ] **Step 2: Update compiled articles**

Update `mobile.md` and `implementation-priorities.md` to state that Home conditions use device coordinates from `@react-native-community/geolocation`, Open-Meteo for weather/marine data, and repo-local native reverse geocoder modules for city display. State explicitly that no new npm native dependency was added for reverse geocoding.

- [ ] **Step 3: Update index and log**

Refresh the architecture index rows for touched articles and append a `2026-07-10` ingest entry to `.wiki/wiki/log.md`.

### Task 4: Verification

**Files:**
- All files changed in Tasks 1-3.

- [ ] **Step 1: Run focused Jest tests**

```bash
yarn workspace @repo/mobile test --watchman=false __tests__/home-conditions-provider.test.ts __tests__/reverse-geocoder-native-source.test.ts
```

- [ ] **Step 2: Run mobile typecheck**

```bash
yarn mobile:typecheck
```

- [ ] **Step 3: Run iOS native build gate**

```bash
yarn ios:build
```

If CocoaPods or simulator services are unavailable, report the exact environment failure. Do not claim the native build passed unless this command exits 0.

- [ ] **Step 4: Run broader repository gate if feasible**

```bash
yarn codex:check
```

If this duplicates a failed environment gate, report the existing blocker instead of hiding it.
