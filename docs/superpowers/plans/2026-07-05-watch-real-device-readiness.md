# Watch Real Device Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the watch app for real-device recording on water-submersion-capable Apple Watch models, keep fake data behind explicit demo/test mode, and fix large mobile watch-profile rendering without losing raw samples.

**Architecture:** Add `captureMode: "real" | "demo"` to the watch sync contract and carry it through Swift, validation, import, and mobile UI. Replace per-sample React Native bars with an SVG profile renderer that downsamples only render points. Split watch recording entry points into real and demo modes, use `CMWaterSubmersionManager` for real sensor data, and simplify watch Home/Recording UI into an instrument-first flow.

**Tech Stack:** watchOS SwiftUI, CoreMotion `CMWaterSubmersionManager`, WatchKit auto-launch authorization, JSON Schema, generated Swift/TypeScript contracts, React Native TypeScript, `react-native-svg`, Jest, Yarn 1, Xcode CLI.

---

## File Structure

Create:

- `apps/mobile/src/utils/session-profile-chart.ts`
  - Pure chart-data utilities: sanitize, sort, peak-preserving downsample, and coordinate mapping.
- `apps/mobile/__tests__/session-profile-chart.test.ts`
  - Unit tests for 850+ sample handling, raw sample preservation, y-axis direction, and sparse temperature data.
- `apps/mobile/ios/DiveWatchApp/Sensors/DemoDepthSensorProvider.swift`
  - Explicit demo/test-only provider, replacing product use of the mock provider name.
- `apps/mobile/ios/DiveWatchApp/Sensors/DepthSensorAvailability.swift`
  - Runtime capability and authorization status model for real underwater capture.
- `apps/mobile/ios/DiveWatchApp/Runtime/DepthAutoLaunchAuthorization.swift`
  - Small wrapper around `WKExtendedRuntimeSession.requestAutoLaunchAuthorizationStatusWithCompletion`.

Modify:

- `packages/contracts/schemas/watch-session.schema.json`
  - Add optional `captureMode` enum.
- `packages/contracts/generated/typescript/index.ts`
  - Regenerate only.
- `packages/contracts/generated/swift/WatchContracts.swift`
  - Regenerate only.
- `packages/contracts/fixtures/*.json`
  - Add `"captureMode": "real"` to current fixtures and one demo fixture if needed.
- `apps/mobile/src/utils/watch-sync-message-validation.ts`
  - Accept and validate `captureMode`, with missing legacy values interpreted as real at read sites.
- `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
  - Preserve raw session and expose demo import behavior through existing watch capture.
- `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
  - Show a `Demo` pill for imported demo logs.
- `apps/mobile/src/screens/logbook/screen.tsx`, `apps/mobile/src/screens/home/screen.tsx`, `apps/mobile/src/screens/memory/screen.tsx`
  - Keep profile renderer usage compatible and add demo markers where entries/sessions are summarized.
- `apps/mobile/src/components/ui/session-profile.tsx`
  - Render SVG line/area profiles instead of one bar view per sample.
- `apps/mobile/src/i18n/resources.ts`
  - Add Korean/English demo labels.
- `apps/mobile/__tests__/watch-session-to-dive-log-entry.test.ts`
  - Assert demo marker preservation and legacy real behavior.
- `apps/mobile/__tests__/watch-sync-message-validation.test.ts`
  - Assert valid/invalid `captureMode` parsing.
- `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
  - Assert large profile details render and demo marker appears.
- `apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift`
  - Add `DiveCaptureMode`, default legacy decoding to `.real`, and encode `captureMode`.
- `apps/mobile/ios/DiveWatchApp/Models/DiveSessionSummary.swift`
  - Preserve capture mode when copying sync status.
- `apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift`
  - Store capture mode and return it on completed records.
- `apps/mobile/ios/DiveWatchApp/Sensors/DepthSensorProvider.swift`
  - Keep provider protocol stable; add availability support in separate helper.
- `apps/mobile/ios/DiveWatchApp/Sensors/RealDepthSensorProvider.swift`
  - Implement CoreMotion water-submersion measurement and temperature callbacks.
- `apps/mobile/ios/DiveWatchApp/Sensors/MockDepthSensorProvider.swift`
  - Rename semantics by replacing call sites with `DemoDepthSensorProvider`; remove if no source references remain.
- `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
  - Remove watch-side plan editing controls, keep mobile planned dive selection, add explicit Demo action and auto-launch/capability status.
- `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
  - Add `recordingMode`, real/demo provider creation, demo badge, cleaner depth-first instruments, and safety-stop-only dedicated UI.
- `apps/mobile/ios/DiveWatchApp/Views/SessionListView.swift`
  - Show demo marker for demo records.
- `apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift`
  - Show demo marker for demo record details.
- `apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift`
  - Show demo marker before save/discard.
- `apps/mobile/ios/DiveWatchApp/Localizable.xcstrings`
  - Add strings used by the new watch UI and remove unused large header/plan-edit strings when safe.
- `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`
  - Include any new Swift source files in the watch target.
- `.wiki/raw/*` and `.wiki/wiki/*`
  - Update long-term project knowledge for real-sensor policy, demo capture mode, and safety boundary.

Do not hand-edit generated contract outputs. Regenerate them from schema scripts.

---

### Task 1: Contract And Mobile Import Capture Mode

**Files:**
- Modify: `packages/contracts/schemas/watch-session.schema.json`
- Modify: `apps/mobile/src/utils/watch-sync-message-validation.ts`
- Modify: `apps/mobile/src/utils/watch-session-to-dive-log-entry.ts`
- Modify: `apps/mobile/__tests__/watch-sync-message-validation.test.ts`
- Modify: `apps/mobile/__tests__/watch-session-to-dive-log-entry.test.ts`
- Regenerate: `packages/contracts/generated/typescript/index.ts`
- Regenerate: `packages/contracts/generated/swift/WatchContracts.swift`

- [ ] **Step 1: Write validation tests**

Add these cases to `apps/mobile/__tests__/watch-sync-message-validation.test.ts`:

```ts
it('accepts explicit demo capture mode', () => {
  const result = parseWatchSyncMessageValue({
    type: 'sessionEnded',
    session: {
      localSessionId: 'demo-session-1',
      schemaVersion: 2,
      captureMode: 'demo',
      startedAt: 1781352000,
      samples: [{ localSessionId: 'demo-session-1', timestamp: 1781352000, depthMeters: 0 }],
    },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.message.session.captureMode).toBe('demo');
});

it('rejects unknown capture mode values', () => {
  const result = parseWatchSyncMessageValue({
    type: 'sessionEnded',
    session: {
      localSessionId: 'bad-capture-mode',
      captureMode: 'mock',
      startedAt: 1781352000,
      samples: [{ localSessionId: 'bad-capture-mode', timestamp: 1781352000, depthMeters: 0 }],
    },
  });

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected invalid capture mode');
  expect(result.error.message).toContain('session.captureMode');
});
```

- [ ] **Step 2: Write import preservation tests**

Add these cases to `apps/mobile/__tests__/watch-session-to-dive-log-entry.test.ts`:

```ts
it('preserves demo capture mode in the raw watch payload', () => {
  const entry = watchSessionToDiveLogEntry({
    session: { ...baseSession, captureMode: 'demo' },
    now: 1781353000,
  });

  expect(entry.watchCapture?.session.captureMode).toBe('demo');
  expect(entry.watchCapture?.samples).toBe(baseSession.samples);
});

it('treats legacy sessions without capture mode as real without rewriting raw payload', () => {
  const entry = watchSessionToDiveLogEntry({
    session: baseSession,
    now: 1781353000,
  });

  expect(entry.watchCapture?.session.captureMode).toBeUndefined();
  expect(entry.watchCapture?.session).toBe(baseSession);
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
yarn workspace @repo/mobile test --watch=false watch-sync-message-validation watch-session-to-dive-log-entry
```

Expected: FAIL because `captureMode` is not yet generated or accepted.

- [ ] **Step 4: Add schema field**

Add this optional property to `packages/contracts/schemas/watch-session.schema.json` under root `properties`, near `schemaVersion`:

```json
"captureMode": {
  "type": "string",
  "enum": ["real", "demo"]
}
```

- [ ] **Step 5: Regenerate contract outputs**

Run:

```bash
yarn check:quick
```

Expected: generated TypeScript includes `captureMode?: "real" | "demo";` in `WatchSessionCommon`, and generated Swift includes a matching optional field.

- [ ] **Step 6: Update runtime validator**

In `apps/mobile/src/utils/watch-sync-message-validation.ts`, add:

```ts
const captureModes = ['real', 'demo'] as const;
```

Add `'captureMode'` to `sessionKeys`, then parse after `schemaVersion`:

```ts
const captureMode = readEnum(objectResult.value, 'captureMode', captureModes, path);
if (!captureMode.ok) {
  return captureMode;
}
assignOptional(session, 'captureMode', captureMode.value);
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
yarn workspace @repo/mobile test --watch=false watch-sync-message-validation watch-session-to-dive-log-entry
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/schemas/watch-session.schema.json packages/contracts/generated/typescript/index.ts packages/contracts/generated/swift/WatchContracts.swift apps/mobile/src/utils/watch-sync-message-validation.ts apps/mobile/src/utils/watch-session-to-dive-log-entry.ts apps/mobile/__tests__/watch-sync-message-validation.test.ts apps/mobile/__tests__/watch-session-to-dive-log-entry.test.ts
git commit -m "feat: carry watch capture mode through imports"
```

---

### Task 2: Mobile SVG Profile Renderer And Downsampling

**Files:**
- Create: `apps/mobile/src/utils/session-profile-chart.ts`
- Create: `apps/mobile/__tests__/session-profile-chart.test.ts`
- Modify: `apps/mobile/src/components/ui/session-profile.tsx`
- Modify: `apps/mobile/__tests__/logbook-manual-entry.test.tsx`

- [ ] **Step 1: Write chart utility tests**

Create `apps/mobile/__tests__/session-profile-chart.test.ts`:

```ts
import { buildProfileRenderModel, downsampleProfilePoints } from '../src/utils/session-profile-chart';
import type { WatchDepthSample } from '../src/types/dive-session';

const sample = (index: number, depthMeters: number, waterTemperatureCelsius = 24): WatchDepthSample => ({
  localSessionId: 'chart-session',
  timestamp: 1781352000 + index,
  depthMeters,
  waterTemperatureCelsius,
});

describe('session profile chart utilities', () => {
  it('keeps raw sample arrays untouched while downsampling render points', () => {
    const samples = Array.from({ length: 850 }, (_, index) => sample(index, index % 50));
    const before = samples.slice();
    const model = buildProfileRenderModel({ samples, kind: 'depth', maxRenderPoints: 160 });

    expect(samples).toEqual(before);
    expect(model.points.length).toBeLessThanOrEqual(160);
    expect(model.rawSampleCount).toBe(850);
  });

  it('maps deeper depth values lower on the chart', () => {
    const model = buildProfileRenderModel({
      samples: [sample(0, 0), sample(1, 10), sample(2, 20)],
      kind: 'depth',
      width: 300,
      height: 100,
      maxRenderPoints: 20,
    });

    expect(model.points[0]!.y).toBeLessThan(model.points[1]!.y);
    expect(model.points[1]!.y).toBeLessThan(model.points[2]!.y);
  });

  it('preserves bucket peaks and valleys', () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      timestamp: 1781352000 + index,
      value: index === 15 ? 35 : index === 25 ? 1 : 10,
    }));

    const result = downsampleProfilePoints(points, 12);

    expect(result.some(point => point.value === 35)).toBe(true);
    expect(result.some(point => point.value === 1)).toBe(true);
    expect(result[0]).toEqual(points[0]);
    expect(result[result.length - 1]).toEqual(points[points.length - 1]);
  });

  it('returns unavailable model for all-missing temperature samples', () => {
    const model = buildProfileRenderModel({
      samples: [sample(0, 3, undefined), sample(1, 5, undefined)],
      kind: 'temperature',
    });

    expect(model.points).toHaveLength(0);
    expect(model.isAvailable).toBe(false);
  });
});
```

- [ ] **Step 2: Run chart tests and verify failure**

Run:

```bash
yarn workspace @repo/mobile test --watch=false session-profile-chart
```

Expected: FAIL because `session-profile-chart.ts` does not exist.

- [ ] **Step 3: Implement chart utilities**

Create `apps/mobile/src/utils/session-profile-chart.ts` with these exported APIs:

```ts
export type ProfileKind = 'depth' | 'temperature';
export type ProfileSourcePoint = { timestamp: number; value: number };
export type ProfileRenderPoint = ProfileSourcePoint & { x: number; y: number };

export function downsampleProfilePoints(points: ProfileSourcePoint[], maxPoints: number): ProfileSourcePoint[] {
  // Bucket by timestamp order, preserve first/last and per-bucket min/max by value.
}

export function buildProfileRenderModel(options: {
  samples: WatchDepthSample[];
  kind: ProfileKind;
  width?: number;
  height?: number;
  maxRenderPoints?: number;
}): {
  points: ProfileRenderPoint[];
  path: string;
  areaPath: string;
  minValue: number;
  maxValue: number;
  rawSampleCount: number;
  isAvailable: boolean;
} {
  // Sort, sanitize, downsample, then map depth with y increasing as depth increases.
}
```

The implementation must filter non-finite values, ignore negative depth values, and map temperature with a normal line-chart scale while keeping depth `0m` at the top.

- [ ] **Step 4: Replace bar renderer with SVG**

In `apps/mobile/src/components/ui/session-profile.tsx`, replace the sample-per-bar `HStack` with:

```tsx
import { Defs, LinearGradient, Path, Stop, Svg } from 'react-native-svg';
import { buildProfileRenderModel } from '../../utils/session-profile-chart';
```

Render one `Svg` with a path and area fill. Keep the existing `testID`, title, and `SessionProfile.Legend` API. For unavailable temperature data, render a compact muted text state rather than empty bars.

- [ ] **Step 5: Add a detail rendering regression**

In `apps/mobile/__tests__/logbook-manual-entry.test.tsx`, add a detail test that creates 850 samples, opens the entry, and asserts:

```ts
expect(root.findByProps({ testID: 'log-entry-detail-depth-profile' })).toBeTruthy();
expect(root.findByProps({ testID: 'log-entry-detail-temperature-profile' })).toBeTruthy();
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
yarn workspace @repo/mobile test --watch=false session-profile-chart logbook-manual-entry
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/utils/session-profile-chart.ts apps/mobile/src/components/ui/session-profile.tsx apps/mobile/__tests__/session-profile-chart.test.ts apps/mobile/__tests__/logbook-manual-entry.test.tsx
git commit -m "fix: render large watch profiles with svg downsampling"
```

---

### Task 3: Swift Capture Mode, Real Sensor, And Demo Provider Split

**Files:**
- Create: `apps/mobile/ios/DiveWatchApp/Sensors/DemoDepthSensorProvider.swift`
- Create: `apps/mobile/ios/DiveWatchApp/Sensors/DepthSensorAvailability.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Sensors/RealDepthSensorProvider.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Models/DiveSessionSummary.swift`
- Modify: `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`

- [ ] **Step 1: Add capture mode model**

Add near `DiveSessionRecord`:

```swift
enum DiveCaptureMode: String, Codable, Equatable {
    case real
    case demo
}
```

Add `let captureMode: DiveCaptureMode` to `DiveSessionRecord`, default legacy decoding to `.real`, encode it in `RecordWatchSessionPayload`, and preserve it in copy helpers such as `withSyncStatus`.

- [ ] **Step 2: Update recorder constructor**

Change `DiveSessionRecorder` to store capture mode:

```swift
private let captureMode: DiveCaptureMode

init(sensorProvider: DepthSensorProvider, captureMode: DiveCaptureMode) {
    self.sensorProvider = sensorProvider
    self.captureMode = captureMode
}
```

Pass `captureMode` into the completed `DiveSessionRecord`.

- [ ] **Step 3: Create explicit demo provider**

Create `DemoDepthSensorProvider.swift` by moving the deterministic timer-based implementation from `MockDepthSensorProvider`. Keep the class name `DemoDepthSensorProvider`. Delete or leave `MockDepthSensorProvider` only if tests still need it; product call sites must not instantiate `MockDepthSensorProvider`.

- [ ] **Step 4: Implement real sensor provider**

Implement `RealDepthSensorProvider` with `CoreMotion`:

```swift
import CoreMotion
import Foundation

final class RealDepthSensorProvider: NSObject, DepthSensorProvider, CMWaterSubmersionManagerDelegate {
    var onSample: ((DepthSample) -> Void)?
    private let manager = CMWaterSubmersionManager()
    private var latestTemperatureCelsius: Double?

    func start() {
        guard CMWaterSubmersionManager.waterSubmersionAvailable else { return }
        manager.delegate = self
        manager.startUpdates()
    }

    func stop() {
        manager.stopUpdates()
        manager.delegate = nil
    }
}
```

In delegate callbacks, emit samples only when depth is finite and non-negative; convert pressure to kPa; cache temperature from `didUpdateTemperature`.

- [ ] **Step 5: Add availability helper**

Create `DepthSensorAvailability.swift` with a small value model:

```swift
struct DepthSensorAvailability {
    let isWaterSubmersionAvailable: Bool
    let authorizationStatusDescription: String

    static var current: DepthSensorAvailability {
        DepthSensorAvailability(
            isWaterSubmersionAvailable: CMWaterSubmersionManager.waterSubmersionAvailable,
            authorizationStatusDescription: String(describing: CMWaterSubmersionManager.authorizationStatus())
        )
    }
}
```

Use the helper from watch Home instead of directly binding Home to a fake provider.

- [ ] **Step 6: Add new Swift files to watch target**

Edit `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj` so `DemoDepthSensorProvider.swift` and `DepthSensorAvailability.swift` are included in the `DiveWatchApp` Sources build phase.

- [ ] **Step 7: Run watch build**

Run:

```bash
yarn watch:build
```

Expected: PASS, or a concrete SDK/API compile error to fix before continuing.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Sensors apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift apps/mobile/ios/DiveWatchApp/Models/DiveSessionSummary.swift apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj
git commit -m "feat: separate real and demo watch capture modes"
```

---

### Task 4: Watch Home Flow, Plan Selection, Demo Entry, And Auto Launch Status

**Files:**
- Create: `apps/mobile/ios/DiveWatchApp/Runtime/DepthAutoLaunchAuthorization.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/HomeView.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Localizable.xcstrings`
- Modify: `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`

- [ ] **Step 1: Remove watch-side plan editing**

Delete `PreDivePlanFields` and `DiveTextField` from `HomeView.swift`. Replace `DivePlanSetupView` with a mobile-plan selector screen that only lists `store.plannedDives`, applies `plannedDive.preDivePlan`, and starts recording. Keep immediate unplanned `freedive` and `scuba` starts on Home.

- [ ] **Step 2: Add explicit demo route**

Add a third Home action:

```swift
NavigationLink {
    RecordingView(store: store, plan: explicitStartPlan(for: .scuba), recordingMode: .demo)
} label: {
    StartSessionCard(
        title: "Demo",
        subtitle: String(localized: "Crown-controlled sample dive"),
        systemImage: "digitalcrown.arrow.clockwise",
        accent: DiveWatchTheme.secondary
    )
}
```

Real start links must pass `.real`.

- [ ] **Step 3: Simplify Home header**

Replace the large `HomeHeader` card with a compact status row that does not render `Text("Dive Watch")`. Keep session count, sensor availability, and auto-launch status as small status pills.

- [ ] **Step 4: Add auto-launch authorization wrapper**

Create `DepthAutoLaunchAuthorization.swift`:

```swift
import WatchKit

@MainActor
final class DepthAutoLaunchAuthorization: ObservableObject {
    @Published private(set) var statusText = String(localized: "Auto launch status unavailable")

    func refresh() {
        WKExtendedRuntimeSession.requestAutoLaunchAuthorizationStatus { status, error in
            Task { @MainActor in
                if let error {
                    self.statusText = error.localizedDescription
                } else {
                    self.statusText = String(describing: status)
                }
            }
        }
    }
}
```

Wire Home to call `refresh()` on appear and show the returned status as convenience-only information.

- [ ] **Step 5: Run watch UI language check**

Run:

```bash
yarn workspace @repo/mobile watch:ui:check
```

Expected: PASS with no forbidden safety guarantee copy.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Runtime/DepthAutoLaunchAuthorization.swift apps/mobile/ios/DiveWatchApp/Views/HomeView.swift apps/mobile/ios/DiveWatchApp/Localizable.xcstrings apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj
git commit -m "feat: simplify watch start flow for real and demo dives"
```

---

### Task 5: Watch Recording Instrument Layout

**Files:**
- Modify: `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/SessionListView.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift`
- Modify: `apps/mobile/ios/DiveWatchApp/Localizable.xcstrings`

- [ ] **Step 1: Add recording mode initializer**

In `RecordingView.swift`, add:

```swift
enum WatchRecordingMode: Equatable {
    case real
    case demo

    var captureMode: DiveCaptureMode {
        switch self {
        case .real: return .real
        case .demo: return .demo
        }
    }
}
```

Initialize `DiveSessionRecorder` through a custom `init(store:plan:recordingMode:)` so `.real` creates `RealDepthSensorProvider()` and `.demo` creates `DemoDepthSensorProvider()`.

- [ ] **Step 2: Add demo badge**

Show a small `StatusPill(title: "Demo", color: DiveWatchTheme.secondary)` in `RecordingView`, `SummaryView`, `SessionListView`, and `SessionDetailView` whenever `captureMode == .demo`.

- [ ] **Step 3: Make the general instrument depth-first**

Remove visible labels like `"CURRENT DEPTH"`, `"Session time"`, `"Current depth"`, and repeated assistant text from the central instrument. Keep large depth/time digits, max/temp/ascent secondary metrics, and accessibility labels where helpful.

- [ ] **Step 4: Keep safety stop dedicated and warning-first**

For `SafetyStopInstrument`, only display explanatory warning text for `.pausedTooDeep`, `.pausedTooShallow`, and `.skippedOrIncomplete`. For `.active`, show timer, zone gauge, and current depth without `"Within stop zone"` style narration.

- [ ] **Step 5: Protect end button spacing**

Keep the end button outside `liveInstrument`, with at least `Spacer(minLength: 8)` or equivalent layout spacing between instrument, end button, and disclaimer. The end button must not overlap metrics on 41mm/45mm/49mm watch layouts.

- [ ] **Step 6: Run watch build and UI check**

Run:

```bash
yarn watch:build
yarn workspace @repo/mobile watch:ui:check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift apps/mobile/ios/DiveWatchApp/Views/SessionListView.swift apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift apps/mobile/ios/DiveWatchApp/Localizable.xcstrings
git commit -m "fix: make watch recording screen instrument first"
```

---

### Task 6: Mobile Demo Markers In Review Surfaces

**Files:**
- Modify: `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
- Modify: `apps/mobile/src/screens/logbook/screen.tsx`
- Modify: `apps/mobile/src/screens/home/screen.tsx`
- Modify: `apps/mobile/src/screens/memory/screen.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Modify: `apps/mobile/__tests__/logbook-manual-entry.test.tsx`

- [ ] **Step 1: Add i18n keys**

Add Korean and English keys:

```ts
demoCapture: 'Demo',
realCapture: 'Real',
```

under `logbook`.

- [ ] **Step 2: Add helper for capture mode**

Use a small local helper where needed:

```ts
function getCaptureModeLabel(session: WatchSession | undefined, t: ReturnType<typeof useTranslation>['t']): string | undefined {
  if (!session || session.captureMode !== 'demo') {
    return undefined;
  }
  return t('logbook.demoCapture');
}
```

Display the returned label in existing `StatusPill` positions without adding bulky cards.

- [ ] **Step 3: Add mobile UI test**

In `apps/mobile/__tests__/logbook-manual-entry.test.tsx`, add a watch entry whose `watchCapture.session.captureMode` is `'demo'`, open detail, and assert a `Demo` pill is present.

- [ ] **Step 4: Run focused tests**

Run:

```bash
yarn workspace @repo/mobile test --watch=false logbook-manual-entry
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/logbook/log-entry-detail.tsx apps/mobile/src/screens/logbook/screen.tsx apps/mobile/src/screens/home/screen.tsx apps/mobile/src/screens/memory/screen.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__/logbook-manual-entry.test.tsx
git commit -m "feat: mark demo watch logs in mobile review"
```

---

### Task 7: Wiki, Verification, And Main Handoff

**Files:**
- Modify: `.wiki/raw/*`
- Modify: `.wiki/wiki/*`

- [ ] **Step 1: Update project wiki**

Record these decisions:

```text
Real watch recording uses real underwater sensor data only.
Fake sensor data is allowed only through explicit demo/test mode.
Demo records sync and import like normal records but remain marked as Demo.
Raw watch samples are preserved; mobile chart downsampling is render-only.
The app remains a non-certified recreational log companion.
```

- [ ] **Step 2: Run final verification**

Run, in order:

```bash
yarn check:quick
yarn workspace @repo/mobile test --watch=false session-profile-chart watch-sync-message-validation watch-session-to-dive-log-entry logbook-manual-entry
yarn mobile:typecheck
yarn watch:build
yarn workspace @repo/mobile watch:ui:check
yarn codex:check
```

Expected: all pass. If `yarn codex:check` duplicates earlier gates and fails only because of an already-reported environment limitation, report the exact limitation and the passing narrower gates.

- [ ] **Step 3: Commit wiki and verification-ready cleanup**

```bash
git add .wiki docs/superpowers/plans/2026-07-05-watch-real-device-readiness.md
git commit -m "docs: record watch real device readiness decisions"
```

- [ ] **Step 4: Confirm main state**

Run:

```bash
git branch --show-current
git status --short
git log --oneline -5
```

Expected: branch is `main`. Only unrelated pre-existing user changes may remain unstaged. If implementation commits were made on another branch, merge that branch into `main` without squashing after verification.
