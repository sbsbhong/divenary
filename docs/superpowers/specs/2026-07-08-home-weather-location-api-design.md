# Home Weather Location API Design

## Goal

Make the Home conditions band use the user's current location to show region context, air temperature, and optional water temperature.

The implementation should replace the current mock-only path with a real provider boundary while preserving app safety boundaries:

- This is a recreational log/review assistant, not a dive-safety decision system.
- Weather, air temperature, and water temperature are contextual information only.
- The app must not score dive suitability, issue marine warnings, or imply certified dive computer behavior.

## Existing Context

The first Home conditions design already created a provider-neutral interface and Home UI:

- `apps/mobile/src/conditions/home-conditions.ts`
- `apps/mobile/src/screens/home/screen.tsx`
- `apps/mobile/__tests__/home-conditions.test.tsx`
- `docs/superpowers/specs/2026-06-26-home-location-conditions-design.md`

This design keeps that interface shape and adds the missing production-oriented pieces: environment configuration, location permission, Open-Meteo API integration, multilingual copy, and user guidance.

## Chosen Approach

Use Open-Meteo directly from the mobile app for this PoC.

Rejected alternatives:

- A pre-permission CTA before requesting location: lower-friction for privacy, but the requested behavior is to ask from Home by default.
- A backend proxy first: better for protecting commercial keys later, but this repo has no backend/Supabase layer yet and the first implementation should stay mobile-scoped.

Open-Meteo is the selected provider because it supports weather and marine forecast data by latitude/longitude and can run without an API key for development and non-commercial evaluation.

## Environment Configuration

Add a development env example with an empty key:

```env
OPEN_METEO_API_KEY=
```

Runtime behavior:

- If `OPEN_METEO_API_KEY` is empty, call the free Open-Meteo endpoints.
- If `OPEN_METEO_API_KEY` is set, call the Open-Meteo customer endpoints and append `apikey` as a query parameter.

Open-Meteo's pricing/docs state that the free API is for non-commercial evaluation/prototyping, while paid plans issue an API key for `customer-api.open-meteo.com`.

Important constraint:

- A key bundled into a React Native app is not a server-side secret. Treat it as a client configuration value for the PoC. A future commercial release should move provider calls behind a backend boundary.

## API Key Guide

For development:

1. Create the local development env file from the example.
2. Leave `OPEN_METEO_API_KEY=` empty.
3. Run the app. It should use the free Open-Meteo endpoint.

For a paid/commercial key:

1. Go to `https://open-meteo.com/en/pricing`.
2. Choose a paid API plan and complete checkout through Stripe.
3. Open-Meteo issues an API key after checkout.
4. Set it in the local env file:

```env
OPEN_METEO_API_KEY=your_open_meteo_key_here
```

5. Restart Metro/native build so the app reloads env configuration.

Relevant provider docs:

- Weather Forecast API: `https://open-meteo.com/en/docs`
- Marine Weather API: `https://open-meteo.com/en/docs/marine-weather-api`
- Pricing/API key behavior: `https://open-meteo.com/en/pricing`

## Location Permission UX

Home should request location permission by default when the conditions controller first runs.

Permission policy:

- iOS: request When In Use location.
- Android: request foreground location for weather lookup. Coarse location is enough for weather context; do not require continuous high-accuracy GPS.
- Do not request Always permission.
- Do not add background location tracking.
- Do not persist coordinates in this scope.

Native configuration:

- Fill `NSLocationWhenInUseUsageDescription` with a clear user-facing reason.
- Add Android foreground location permission entries.

Denied state:

- If the user denies or blocks location, show a specific permission-denied card.
- Copy should explain that current location weather, air temperature, and water temperature cannot be loaded without location permission.
- The card should keep the rest of Home usable.

Actions:

- `Open Settings`: use `Linking.openSettings()` when available.
- `Try Again`: rerun the location and conditions request.

Foreground behavior:

- When the app returns to foreground, the conditions controller should re-check permission once so users who changed settings can recover without restarting.

## Data Flow

Home should not own platform permission or API details directly.

Suggested units:

- `LocationService`: requests permission and resolves one current/cached coordinate.
- `OpenMeteoConditionsProvider`: builds URLs, calls Weather and Marine APIs, and normalizes responses.
- `useHomeConditions`: coordinates loading state, retries, app foreground refresh, and Home-facing actions.
- `HomeConditionsBand`: renders ready, loading, denied, unavailable, and error states.

Flow:

1. Home mounts.
2. `useHomeConditions` sets `loading`.
3. `LocationService` requests/checks foreground location.
4. If denied, snapshot becomes `permissionDenied`.
5. If coordinates are available, provider fetches weather and marine conditions.
6. Provider returns a `HomeConditionsSnapshot`.
7. Home renders location label, local time, air temperature, optional water temperature, source, and updated time.

## Provider Behavior

Weather API:

- Request current air temperature by latitude/longitude.
- Use Celsius.
- Use the API's returned timezone/local timestamp when available.

Marine API:

- Request current sea surface temperature.
- Prefer sea grid cell selection for marine data.
- If no marine value is available, keep the snapshot ready with no water temperature and show the neutral water-unavailable UI.
- If Marine fails while Weather succeeds, still show air temperature.

Location label:

- Do not add a separate reverse-geocoding dependency in this scope.
- Use a conservative label from available API/timezone data or fallback to the existing "Current location" translation.
- Better city/region naming can be added later behind the same provider boundary.

## Multilingual Copy

All new user-facing strings must go through the existing `react-i18next` resource file:

- `apps/mobile/src/i18n/resources.ts`

Required Korean and English copy:

- Checking location permission/location.
- Permission denied title and body.
- Open Settings.
- Try Again.
- Weather conditions unavailable.
- Weather API failed.
- Water temperature unavailable.
- Open-Meteo source/attribution text.

The existing language switcher should continue to switch the Home conditions copy without requiring a provider refetch unless locale-sensitive labels need to refresh.

## Error Handling

Use distinct states:

- `loading`: requesting permission, location, or provider data.
- `permissionDenied`: location permission denied or blocked.
- `unavailable`: location timeout, location services unavailable, or no coordinate.
- `error`: provider request failed or response shape is invalid.
- `ready`: at least weather context was resolved.

Behavior:

- Home Logbook and Planning actions remain available in all states.
- Weather failure must not block app startup.
- API errors should expose stable UI copy, not raw provider messages.
- Provider internals may keep raw error details for tests/logging, but user copy stays concise.

## Testing

Provider tests:

- Empty `OPEN_METEO_API_KEY` uses free API base URLs.
- Non-empty `OPEN_METEO_API_KEY` uses customer base URLs and appends `apikey`.
- Weather success plus Marine success returns air and water temperature.
- Weather success plus Marine failure returns ready snapshot with air temperature and water unavailable.
- Weather failure returns error/unavailable state.
- Invalid response shape is handled without crashing.

Location/controller tests:

- Permission allowed plus coordinates calls the provider.
- Permission denied returns `permissionDenied`.
- Location timeout returns `unavailable`.
- Retry reruns the request.
- Foreground return re-checks permission once.

Home UI tests:

- Korean and English denied copy render.
- Settings and retry buttons render in denied/error states.
- Existing primary Home actions remain visible when conditions fail.
- Water temperature tile is hidden or neutral when no marine value exists.

Verification gates:

- `yarn mobile:typecheck`
- `yarn workspace @repo/mobile test home-conditions.test.tsx`
- Try `yarn ios:build` if CocoaPods/Xcode workspace state permits because location permission plist/manifest/native config changes are in scope.

## Out of Scope

- Backend proxy or Supabase integration.
- Storing user location.
- Background location tracking.
- Manual city search.
- Reverse geocoding provider.
- Weather alerts, tide/current planning, wave recommendation, route planning, no-fly, decompression, gas, or emergency guidance.
- Dive suitability scoring.

## Open Product Risk

Client-side provider keys are exposed in mobile apps. This is acceptable for a development PoC but not enough for a commercial abuse-prevention model. Productization should move Open-Meteo calls to a backend once auth/cloud sync exists.
