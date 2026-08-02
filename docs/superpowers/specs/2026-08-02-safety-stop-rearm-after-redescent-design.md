# Safety Stop Rearm After Redescent Design

## Context

The watch safety-stop controller currently treats `completed` as a terminal state. Once the recommended three-minute countdown reaches zero, all later depth samples are ignored. A diver who descends again during the same scuba recording therefore never receives another safety-stop reminder.

Divenary is a non-certified logging and reminder tool. This change must not introduce decompression, tissue-loading, ceiling, NDL, or safe-ascent calculations.

## Decision

After a completed safety stop, reaching a current depth of at least 10 meters rearms the existing three-minute recommended safety-stop reminder.

The 10-meter threshold reuses `SafetyStopConfiguration.armDepthMeters`. The transition depends on the current depth sample, not the session's historical maximum depth. It is a fixed reminder rule rather than a physiological or decompression calculation.

The controller reuses the existing `armed` status. No new watch/mobile contract status is added.

## State Transitions

- `completed` remains unchanged while the current depth is less than 10 meters.
- `completed` transitions to `armed` when the current depth is at least 10 meters.
- Rearming resets `remainingSeconds` to 180 seconds and `timeInZoneSeconds` to zero.
- Rearming clears the previous `startedAt`, `completedAt`, and outside-zone timing state.
- After rearming, entering the existing 2.7-6.3 meter counting zone starts a new countdown from 180 seconds.
- Surfacing after completion without reaching 10 meters keeps the completed result.
- Existing pre-completion pause and 30-second outside-zone reset behavior remains unchanged.
- `skippedOrIncomplete` remains terminal for the completed recording flow.

## Data and UI Impact

The existing `SafetyStopRecord` shape and `SafetyStopStatus` values are sufficient. The live watch UI already renders `armed`, `active`, paused, and completed states, so no contract, generated output, mobile validator, or mobile review UI change is required.

When a completed stop is rearmed, the in-progress record represents the latest recommendation cycle. Earlier completion timestamps and credited time are not retained as separate cycles. Multi-cycle history is outside this focused fix.

## Safety Boundary

The feature remains a rule-based recommended reminder. It does not claim that a diver is safe to ascend, that decompression is complete, or that three minutes is sufficient for a particular physiological state. It does not replace a certified dive computer or dive plan.

## Testing

Add focused `SafetyStopControllerTests` coverage proving that:

- a completed stop remains completed at 9.9 meters;
- a completed stop rearms at exactly 10 meters;
- rearming resets timer, credited time, and timestamps;
- returning to the counting zone starts a fresh 180-second countdown;
- a historical `maxDepthMeters` above 10 meters does not rearm while the current sample remains shallower than 10 meters.

Run the focused watch test target first, then the repository's `yarn watch:build` and `yarn codex:check` gates.

## Out of Scope

- Decompression or tissue-loading calculations
- A time-based formula for rearming after completion
- New safety-stop statuses or sync-contract fields
- Multiple safety-stop cycle history in a single session record
- User-configurable thresholds or durations
- Changes to incomplete-stop or dive-ending behavior
