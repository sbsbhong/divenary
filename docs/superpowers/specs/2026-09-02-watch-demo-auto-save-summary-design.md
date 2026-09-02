# Watch demo automatic save and summary

## Goal

After a demo or debug-test recording ends, save the captured `DiveSessionRecord` automatically and show its saved-log summary without controls that obscure the log. The user returns to the Watch home screen through the same leading back control used by a completed real session.

## Scope

- Apply only to `SimulatedRecordingFlowView` and its lifecycle controller.
- Preserve the real underwater recording flow unchanged; it is the behavioural and visual reference.
- Keep `0.0 m` as the initial depth display when no sensor sample exists. This change does not alter submersion sensing or Water Lock behaviour.

## Behaviour

1. The demo starts and records as it does today.
2. Ending recording obtains the record and immediately attempts `DiveSessionStore.save`.
3. On success, reset the recorder and enter a saved-summary phase carrying the saved record.
4. Render `SavedSessionSummaryView` for that phase. It presents the complete session content and one leading chevron back action. The action dismisses the demo route only; it never deletes the saved record.
5. If saving fails, keep the unreset recorder and captured record in memory, show a non-destructive `Retry Save` state, and retry the same save. Do not expose a discard/delete action in the completed-demo UI.
6. If the route disappears before save succeeds, retain the existing cleanup behaviour for unfinished recordings. A completed, unsaved record remains retryable while its route stays presented.

## Lifecycle shape

`ready -> recording -> saving -> savedSummary -> completed`

`recording -> saving -> savePersistenceError -> saving` on retry.

The previous `summary`, `saveSummary`, and `discardSummary` states/actions are removed. Completion still prevents a second recorder start when SwiftUI redraws the route.

## UI

- Reuse `SavedSessionSummaryView`; do not duplicate its metric, safety-boundary, or back-navigation layout.
- The summary status is `Saved` and retains its existing `Edit details on iPhone.` footer.
- The temporary saving and retry states follow the real-recording wording and visual treatment.

## Tests

- Finishing a demo saves exactly once, resets the recorder, and exposes the saved-summary phase.
- A save failure retains the record and recorder state, then a retry saves and reaches saved summary.
- Dismissing the saved summary completes the flow without any delete/cancel request.
- Existing route-disappearance cleanup remains covered for an unfinished recording.

## Risks and boundaries

The change must not silently discard a captured record after a failed save, restart a completed demo on view reappearance, or change safety-related log content. No depth calculation, underwater guidance, or sensor behaviour is added.
