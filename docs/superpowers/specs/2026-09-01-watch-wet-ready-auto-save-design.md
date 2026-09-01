# Watch Wet Ready and Automatic Session Save Design

## Context

A physical pool test exposed two wet-use failures in the watch app.

First, shallow submersion can bring Divenary to the foreground before watchOS delivers the underwater extended runtime session that starts recording. During that interval, Water Lock disables touch, but the current home screen requires touch to choose Freedive or Scuba. Unlocking Water Lock only to select a mode interrupts the intended wet-use flow.

Second, the current real-session summary asks for rating, perceived exertion, visibility, water condition, and a note before exposing Save and Discard. Those fields are unsuitable for immediate wet use and force the wearer to unlock Water Lock before preserving the captured session.

This design makes the automatic real-dive path touchless from shallow submersion through local persistence. It does not turn the full watch app into a Crown-only interface. Dry use keeps the existing full home and review surfaces.

## Goals

- Show a focused Wet Ready surface when water is detected before real recording begins.
- Let the wearer select Freedive or Scuba by rotating the Digital Crown.
- Start automatic recording from the watchOS underwater runtime lifecycle, not from a duplicate app-defined depth or elapsed-time threshold.
- Freeze the selected mode and pre-dive plan when recording begins.
- Save a completed real session locally without post-dive input or an explicit Save action.
- Preserve the completed record across persistence failures and make retries idempotent.
- Keep existing watch-mobile contract, WatchConnectivity acknowledgement, account sync, and guest-claim meanings unchanged.

## Non-Goals

- Switching between Freedive and Scuba during an active session
- Starting a session merely because 30 seconds elapsed in water
- Adding an app-owned 1-meter or 3-meter automatic-start threshold
- Providing Demo, saved-session browsing, plan selection, notes, or destructive actions on Wet Ready
- Immediate post-dive deletion
- New decompression, tissue-loading, gas-switching, emergency, or certified dive-computer behavior
- Watch session schema or generated contract changes

## Considered Approaches

### Coordinator-Owned Wet Lifecycle

Extend `RealDiveSessionCoordinator` so it owns Wet Ready, mode locking, runtime adoption, completion persistence, and the resulting saved-summary or error state.

This is the selected approach. It keeps lifecycle decisions independent of SwiftUI rendering and gives runtime, water, recorder, and persistence events one serialized state machine.

### Home-View Wet Overlay

Have `HomeView` display Wet Ready and independently start the recorder when runtime state changes.

This would require less initial restructuring, but it would split lifecycle ownership between the view and coordinator. It is especially vulnerable when the underwater runtime arrives before the water-state UI update or when the app launches while already below the automatic-runtime depth.

### App-Defined Depth or Time Trigger

Start at a fixed depth, or after a fixed time in water.

This is rejected. A 3-meter threshold loses too much of the profile and excludes shallow sessions. A separate 1-meter threshold duplicates platform lifecycle behavior and can disagree with watchOS. A 30-second trigger creates false or empty sessions while the wearer is floating or waiting at the surface.

## Runtime Architecture

`RealDiveSessionCoordinator` remains the authority for real-session lifecycle. It gains:

- a Wet Ready phase with the currently armed `DiveMode`;
- an immutable active `PreDivePlan` once recording starts;
- a completion-persistence dependency that can save a `DiveSessionRecord`;
- distinct recoverable states for start/setup failure and completed-record save failure;
- a saved-summary phase that only contains a record after local persistence succeeds.

The persistence dependency should be a small protocol, implemented by `DiveSessionStore`, rather than a SwiftUI closure. The protocol only needs the existing idempotent save operation required by the coordinator. It must not introduce Supabase, account identity, or mobile sync concepts into the watch runtime.

`HomeView` or the app root forwards published water-state changes to the coordinator. The view does not decide state transitions. On appearance it also forwards the latest state so an event observed before the SwiftUI hierarchy became active is not lost.

The existing `preferredMode` getter becomes a read/write preference boundary. Wet Ready initializes from the persisted preferred mode. Crown changes update both the coordinator's armed mode and the persisted preference. Once recording begins, the coordinator stores the active plan and later preference changes cannot alter the active session.

## State Model

The real-session state machine has the following conceptual phases:

- `idle`
- `wetReady(mode)`
- `recording(source, plan)`
- `completing(source, record)`
- `savedSummary(record)`
- `noSamples`
- `awaitingRuntimeInvalidation(source)`
- `startPersistenceError(source)`
- `savePersistenceError(record)`

The implementation uses distinct start-error and save-error cases. Start error retains its `RealDiveStartSource`; save error retains the finalized `DiveSessionRecord`. A save failure must never collapse into a generic state that loses the record.

## State Transitions

| Current phase | Event | Next phase | Required effect |
| --- | --- | --- | --- |
| `idle` | Manual Freedive or Scuba start | `recording` | Start recorder and manual runtime immediately with the explicit plan. |
| `idle` | Water becomes submerged | `wetReady(preferredMode)` | Arm the stored preferred mode without creating a record. |
| `wetReady` | Crown selection changes | `wetReady(newMode)` | Persist the new preferred mode and provide selection feedback. |
| `wetReady` | System runtime is adopted | `recording(.systemAutoLaunch, lockedPlan)` | Start the recorder once with `PreDivePlan(diveMode: armedMode)` and freeze the plan. |
| `wetReady` | Water is stably not submerged before runtime adoption | `idle` | Leave without creating, cancelling, or saving a session. |
| `idle` | System runtime arrives before the water event | `recording(.systemAutoLaunch, lockedPlan)` | Use the stored preferred mode as a race-safe fallback. |
| `recording` | Runtime invalidates with captured samples | `completing` | Finalize exactly one record and attempt local save. |
| `completing` | Save succeeds | `savedSummary` | Reset completed recorder state only after save succeeds. |
| `completing` | Save fails | `savePersistenceError` | Retain the same finalized record and expose retry. |
| `savePersistenceError` | Retry succeeds | `savedSummary` | Save the same session ID once and then reset recorder state. |
| `recording` | Runtime invalidates without samples | Existing no-sample outcome | Preserve existing manual/system-auto-launch no-sample policy. |

An elapsed-time value never transitions `wetReady` to `recording`. A `notSubmerged` event must remain stable for two seconds before it dismisses Wet Ready. This is a lifecycle debounce only; it never starts or creates a session.

## Wet Ready UI

Wet Ready is a full-screen, single-purpose real-dive surface. It is not a compact version of Home.

It displays:

- the armed mode, Freedive or Scuba;
- a large mode-specific icon and color;
- a concise `Ready` state;
- copy equivalent to `Descend to start recording automatically`;
- a Digital Crown rotation hint;
- current shallow depth only when a valid measurement is already available.

It omits Demo, planned-dive selection, saved sessions, subjective metadata, Save, Discard, and Delete.

The selector has exactly two values. It uses the repository's established explicit `digitalCrownRotation` pattern, automatically acquires focus, updates the armed mode immediately, and provides haptic and visible feedback at each value change. It does not require Crown press confirmation because watchOS reserves Crown presses for system behavior. Two large tap targets mirror the same selection when touch is available, but the flow never depends on touch.

Physical-device validation must prove that the explicit Crown binding retains or reacquires focus after automatic launch. If that exact control cannot satisfy the gate, the design must return for revision instead of silently substituting different selection semantics.

## Recording Start Policy

Dry manual starts remain unchanged: tapping a Home start card immediately starts its explicit real-dive plan and bypasses Wet Ready.

For automatic starts:

1. A submersion event enters Wet Ready.
2. The wearer may rotate the Crown to change the armed mode.
3. The watchOS-provided underwater extended runtime session is the authoritative start event.
4. Runtime adoption freezes the armed mode into an active plan and starts recording.

The app does not reproduce the platform's approximate automatic-runtime depth rule. If the system runtime arrives before Wet Ready could be shown, the coordinator starts immediately with the stored preferred mode. Missing a portion of an already-started underwater profile is worse than withholding recording for a new confirmation step.

Shallow-water sessions that never receive the automatic runtime use an explicit dry Home start. The existing Action Button start path remains an optional supported-device shortcut; it is not a universal Wet Ready confirmation requirement.

## Active-Mode Lock

Mode selection ends when recording begins. No Crown, touch, Action Button, or water-state event can change the active mode.

The recording UI must render from the coordinator's immutable active plan, not from the mutable `DiveSessionStore.preferredDiveMode`. This prevents the displayed instrument and recorder payload from disagreeing.

If a wearer performs both activities, they end and preserve the first session at the surface, then start a separate session in the other mode. Reclassifying or splitting a live session below the surface is outside scope because it would omit or duplicate profile samples and give ambiguous meaning to the resulting records.

## Session End Policy

This design does not add a new depth-, timer-, gesture-, or Crown-press-based end condition. Existing runtime invalidation and Action Button end behavior remain the real-session completion triggers and retain their existing surface and elapsed-time guards.

User-facing copy must not imply that the app receives a Digital Crown press. Holding the Crown to disable Water Lock is a system action, not an app confirmation mechanism.

A future Crown-rotation confirmation gesture for devices without an Action Button requires a separate physical-device usability design because accidental session termination during a freedive surface interval would be a significant data-loss risk.

## Automatic Completion Persistence

After a real runtime ends with captured samples, local persistence happens before post-dive UI is considered complete:

1. The recorder finalizes one `DiveSessionRecord`.
2. The coordinator retains the finalized record in the `completing` phase.
3. The coordinator calls the watch-local persistence boundary.
4. On success, the coordinator resets completed recorder state and presents `savedSummary`.
5. On failure, the coordinator keeps the same record in `savePersistenceError` and retries without generating a new ID.

The immediate real-session path never asks the wearer to enter subjective metadata or select Save versus Discard.

Unentered values remain semantically absent:

- `rating`: `nil`
- `perceivedExertion`: `nil`
- `visibilityRating`: `nil`
- `notes`: existing planned quick note when present, otherwise `nil`
- `waterCondition`: `.unknown`

The app must not replace missing input with invented neutral or positive ratings.

## Saved Summary UI

The real-session completion surface is read-only and begins with an unambiguous locally saved state. It can show:

- saved status;
- dive mode and capture provenance;
- start and end time;
- duration, maximum depth, and sample count;
- freedive count and longest segment for Freedive;
- the existing non-certified reminder summary for Scuba;
- a concise note that subjective details can be completed on iPhone.

It does not include post-dive rating controls, a text field, Save, Discard, or Delete. Deletion remains a dry watch or mobile review action after durable save.

The shared visual summary is separated from completion actions. Real sessions use automatic persistence and read-only saved state. Demo and debug flows reuse the read-only metrics, remove the subjective metadata inputs, and retain their existing explicit Save/Discard actions so test data is not automatically accumulated.

The real saved summary remains visible while Water Lock is active and requires no action. A `Done` action is available after touch becomes usable and returns the coordinator to `idle`. Relaunching the app after a successfully persisted summary also starts from `idle`; the saved record remains available in Saved Sessions. The coordinator does not discard or recreate the saved record when dismissing this UI state.

## Persistence Failure and Recovery

A completed record is more valuable than immediate navigation. Therefore:

- the recorder is not reset before local save succeeds;
- save failure retains the finalized record and session ID;
- foreground restoration retries the retained record automatically;
- an explicit Retry control is available when touch is usable;
- repeated retry requests are idempotent;
- failure is never treated as Discard;
- the UI must not show `Saved` until the local store reports success.

If process termination occurs after record finalization but before successful publication, recovery continues to rely on the recorder's existing durable active-session/profile artifacts. Implementation planning must preserve the current artifact cleanup order rather than introducing a second ad hoc temporary-record format.

## Race and Error Handling

The implementation must handle these event orders:

- submersion, then Wet Ready, then runtime adoption;
- runtime adoption before the SwiftUI water-state update;
- app launch while already below the automatic-runtime depth;
- transient not-submerged events while Wet Ready is visible;
- runtime invalidation during setup failure recovery;
- repeated runtime delegate callbacks;
- app deactivation during completion save;
- repeated save retries.

The invariants are:

- recorder start occurs at most once per runtime;
- active mode and plan are frozen exactly once;
- a finalized record keeps one local session ID;
- local save succeeds at most once semantically, even if requested repeatedly;
- completed data is not cleared before verified local save;
- no-sample automatic launches do not create empty logs.

Sensor unavailability or authorization failure continues to use the existing readiness/error presentation. Wet Ready must not claim recording readiness if real sensor capture is unavailable.

## Contract, Sync, and Ownership Boundaries

No contract change is required. The current watch record and generated sync schema already permit absent subjective fields and an unknown water condition.

Automatic save changes only when the watch-local record is published. It does not change downstream meanings:

- watch local save means the watch has durably stored the record;
- mobile import acknowledgement means the mobile local repository stored the imported record;
- neither acknowledgement means account cloud sync or guest claim completed.

The watch runtime remains free of Supabase clients, account IDs, authentication, and provider callbacks.

## Safety Boundary

Wet Ready and automatic save are logging controls. They do not determine whether it is safe to descend, continue, surface, or switch activities. Copy must describe recording readiness and platform state only.

Existing Scuba reminder surfaces remain explicitly non-certified and must not become decompression, tissue-loading, gas-switching, emergency, or medical guidance.

## Expected Code Surface

- `apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift`
  - Wet Ready, locked active plan, completion save, and recoverable save-error phases
- `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift`
  - persistence and preferred-mode dependency wiring
- `apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift`
  - touchless two-mode selector
- `apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift`
  - water-state forwarding and phase routing without lifecycle decisions
- `apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift`
  - render the locked plan and saved/error phases
- `apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift`
  - separate read-only metrics from Demo/debug actions and remove subjective real-session input
- `apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings`
  - Wet Ready, saved, and recovery copy
- `apps/mobile/ios/DivenaryWatchAppTests/RealDiveSessionCoordinatorTests.swift`
  - lifecycle, race, mode lock, automatic save, and recovery coverage
- focused UI policy tests or checks as needed for Crown selection and summary action boundaries

Generated contract files are not edited.

## Automated Verification

Focused tests must prove:

- submersion enters Wet Ready without starting the recorder;
- Wet Ready initializes from the persisted preferred mode;
- Crown selection updates the armed and persisted mode;
- runtime adoption starts exactly the armed mode;
- runtime-first ordering uses the preferred-mode fallback;
- stable water exit before runtime adoption returns to idle without a record;
- elapsed time alone never starts a Wet Ready session;
- recording rejects later mode changes;
- the recording UI receives the immutable active plan;
- real completion automatically saves exactly once;
- saved records retain `nil` subjective values and `.unknown` water condition;
- save failure retains the same record and successful retry does not duplicate it;
- recorder cleanup occurs only after save success;
- no-sample automatic runtime invalidation does not create an empty session;
- Demo/debug does not inherit automatic-save accumulation unintentionally.

Run the focused watch test target first, followed by:

- `yarn watch:build`
- `yarn workspace @repo/mobile watch:ui:check` when localized UI changes are present
- `yarn codex:check`

## Physical-Device Gate

The following behavior cannot be approved from Simulator alone:

- Water Lock remains active while Crown rotation changes Wet Ready selection;
- the selector reliably acquires Crown focus after automatic launch;
- shallow submersion presents Wet Ready before runtime adoption when the platform provides that interval;
- actual runtime adoption starts the selected mode;
- runtime-first launch starts the preferred fallback mode;
- transient surface/submersion changes do not create empty sessions;
- Action Button completion still works with the new coordinator phases;
- completion reaches a locally saved summary without post-dive touch;
- retry preserves the same record under a forced local-save failure.

Public-release claims about underwater behavior remain blocked until this gate passes on supported Apple Watch hardware.
