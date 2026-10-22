Source URL: /private/tmp/claude-501/-Users-hongseongbin-Projects-diving-app/f4b09df3-cdb9-4f9a-b8ca-756d22c6ef72/scratchpad/watch-fix/review/review.md
Collected: 2026-10-22
Published: 2026-10-22

# Watch review: recovery and live values

Read-only review of the uncommitted watchOS changes in `/Users/hongseongbin/Projects/diving-app`, including `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`. Findings are ranked by severity. P1 means potential data loss; P2 means incorrect behavior or an incomplete functional fix; P3 means a localized usability defect.

1. **P1 — The legacy JSON-file migration can still delete a conflicting source record.**

   Location: [DiveSessionStore.swift:288](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift:288), calling [DiveProfileArtifactStore.swift:342](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Storage/DiveProfileArtifactStore.swift:342).

   Scenario: `savedDiveSessionRecords.json` contains a record whose UUID already exists in the artifact manifest, but whose samples or metadata differ. The file migration only verifies that the existing artifact is internally valid, skips the source record, and deletes the legacy file at line 354. The differing source content is permanently lost. It also performs its final `loadEntries()` after deleting the source, so a failure at that point cannot preserve the source. The new UserDefaults migration has a canonical-content comparison, but this other supported migration path does not.

   Minimal fix: apply the same sanitized canonical-content comparison to existing file-migration entries; read/validate the final manifest before removing the legacy file. Add the existing conflicting-content test with `recordsStorageURL` as the source instead of UserDefaults. **This is a pre-existing gap left unresolved by intended fix A, not a newly introduced helper regression.**

2. **P2 — History Retry clears recovery errors without retrying the missing recording.**

   Location: [DiveSessionStore.swift:151](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift:151), [DiveSessionStore.swift:285](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift:285).

   Scenario: an interrupted recording has a readable journal, but startup finalization fails, for example because storage is full. `recoverInterruptedRecordings()` sets `.failed` at line 416. After space is available, tapping Retry calls only `load()`, which sets `.loaded` and reads the finalized manifest. The journal is never retried, and the screen can now say “No saved sessions” despite the recoverable log still being present. A startup directory-read failure has the same retry problem.

   Minimal fix: retain the unresolved startup recovery state/candidates and retry those candidates, excluding recordings started in this process. Do not clear the recovery error merely because the finalized manifest loaded. Preserve the existing protection against finalizing a current recording.

3. **P2 — The freedive timer still freezes when samples stop.**

   Location: [RecordingView.swift:473](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift:473); value supplied at [RecordingView.swift:293](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift:293).

   Scenario: a freedive segment is active, then depth callbacks stop. Its `durationSeconds` is calculated using the last sample timestamp in `FreeDiveSessionEngine.activeSegment`, and `freeSnapshot` is published only from the recorder's sample callback. The one-second timer updates session elapsed time, not this segment duration. After depth becomes stale, the large number stays frozen; the change merely labels it “Last observed dive time.” This does not implement the requested timer behavior.

   Minimal fix: derive the displayed running duration from the active segment's start time and the recorder's clock, without synthesizing depth samples or confirming a surface transition. Test advancing time without samples. The new `testMissingDepthLabelsFrozenDiveTimeAndHidesSurfaceInterval` checks formatter labels only and explicitly accepts the frozen behavior, so it cannot validate this requirement.

4. **P2 — Temperature freshness is extended by reused depth samples.**

   Location: [DiveSessionRecorder.swift:330](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift:330), expiry at [DiveSessionRecorder.swift:263](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift:263).

   Scenario: temperature is measured at t=0. `WaterSubmersionCoordinator` legitimately includes that same reading in a depth sample at t=59, then depth callbacks stop. The recorder records t=59 as the temperature measurement time, so at t=61 it still displays the value and will not clear it until after t=119. The measurement is already older than 60 seconds. The provider knows the original timestamp, but that information is lost before the recorder's new expiry check.

   Minimal fix: carry the actual temperature measurement timestamp/expiry through a live-only provider interface, or query provider freshness from the timer. Keep the sync payload unchanged. Cover the real provider-to-recorder sequence with one temperature event and a later depth event; the new test emits only a temperature-bearing sample at t=0 and misses this case.

5. **P2 — Wet Ready still has no Home exit when auto-launch is authorized.**

   Location: [WetReadyView.swift:9](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift:9), used at [WetReadyView.swift:106](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift:106).

   Scenario: the coordinator enters `.wetReady` while the authorization status is `.active`, but a system recording session has not been adopted. This is precisely a not-recording state; authorization does not establish that a recording is running. The new condition hides Home, while `RealRecordingFlowView` also hides the system Back button. Without a usable assigned Action Button, the user cannot return to Home to start manually while this state persists.

   Minimal fix: offer Home in every Wet Ready authorization state and retain `dismissWetReady()`'s suppression until dry. Test `.active` as well as `.inactive` and `.unknown`; the new guidance test omits `.active`.

6. **P3 — Korean crown hints omit the direction needed to move pages.**

   Location: [Localizable.xcstrings:732](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings:732), [Localizable.xcstrings:748](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings:748).

   Scenario: on a Korean-language watch without an Action Button, the Details hint says only “크라운 ▸ 실시간,” while the model requires a negative/backward rotation. Continuing forward does nothing because the crown stops at Details. The English strings now specify forward/back, but both Korean translations omit that distinction, leaving the intended fix incomplete for Korean users.

   Minimal fix: translate the rotation directions in both strings and assert the rendered Korean catalog values, rather than only the localization keys.

The intended fixes are incomplete in the cases above. Two further scope limits should be retained in the follow-up:

- **History error reporting:** `DiveProfileArtifactStore.loadActiveRecordings()` catches individual metadata/journal read failures internally at line 451. The new outer catch in `recoverInterruptedRecordings()` cannot report these; a skipped or quarantined recording can still leave history marked loaded. Return per-record recovery failures and retain a visible error for them. This behavior predates the diff.
- **Save-failure Action Button copy:** the real failure screen states the behavior, but [SimulatedRecordingFlowView.swift:429](/Users/hongseongbin/Projects/diving-app/apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift:429) does not. `endDive()` removes the simulated override even after save failure, so the next press reaches the real coordinator; it does not retry the simulated log. State that behavior accurately, or route the press through an explicit simulated retry/handoff.

The other requested protections are present in the inspected code: default/no-depth plans no longer invent an 18 m tag; selected plans are revalidated against the current plan list; leading/trailing gaps over 30 seconds qualify the saved stop result as unknown; unavailable live depth pauses the stop display and hides the live surface interval; recovered records have a marker. Home exits retain completed records in the app-scoped retry dictionary and keep their journals, and the new retry/new-start paths do not cancel those records. These observations establish in-process retention, not a runtime-tested durability guarantee.

The real Action Button end path still requires at least 180 seconds and `.notSubmerged`, now also rejects repeated ends, and publishes `isEnding` before invalidation. No touch end path or sensor/stop/ascent haptic was added. The Always-On model stays on Live while dimmed and accepts movement again when `setAlwaysOn(false)` is delivered; I found no deterministic End-page regression in that model. Actual wake/AppIntent ordering was not exercised. No new diving maneuvers or safety instructions were added. Unknown stop outcomes use placeholders. Sync payload fields are unchanged; the new plan storage field is optional, the optional depth field accepts existing numeric values, and the recovery label uses the already-persisted optional interruption flag.

Validation: ran the requested diff and inspected affected implementations, callers, persistence helpers, localization entries, and relevant tests. `git diff --check -- apps/mobile/ios apps/mobile/__tests__/watch-connectivity-native-source.test.ts` passed. An attempted in-memory run of the TypeScript source assertions failed before producing results: Node exited 139 with `ERROR: SecItemCopyMatching failed -50`. No XCTest, simulator, or build result is claimed. No repository files were modified; the only authored file is this `review.md`.
