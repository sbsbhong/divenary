Source URL: project conversation and local implementation
Collected: 2026-07-09
Published: 2026-07-09

# Pre-device depth safety sync readiness

The user confirmed that real-device validation is now possible once a pool schedule is available, and asked to finish the "next immediate work" first. The chosen policy was option 2 with the recommended wording: mobile logs and plans may exceed 40m, but values above 40m must show a warning. Watch recording must also show a warning if current depth exceeds 40m. The warning should be present but visually restrained.

Implementation plan:

- `docs/superpowers/plans/2026-07-09-pre-device-depth-safety-sync-readiness.md`

Implemented source areas:

- `apps/mobile/src/utils/unsupported-depth.ts`
- `apps/mobile/src/screens/logbook/log-entry-editor.tsx`
- `apps/mobile/src/screens/logbook/screen.tsx`
- `apps/mobile/src/screens/logbook/log-entry-detail.tsx`
- `apps/mobile/src/screens/planning/plan-mode-fields.tsx`
- `apps/mobile/src/screens/planning/plan-detail.tsx`
- `apps/mobile/src/i18n/resources.ts`
- `packages/contracts/schemas/watch-session.schema.json`
- `packages/contracts/fixtures/scuba-safety-stop-watch-sync-message.json`
- `packages/contracts/fixtures/metadata-rich-watch-sync-message.json`
- `packages/contracts/generated/typescript/index.ts`
- `packages/contracts/generated/swift/WatchContracts.swift`
- `apps/mobile/src/utils/watch-sync-message-validation.ts`
- `apps/mobile/ios/DiveWatchApp/Models/DiveSessionRecord.swift`
- `apps/mobile/ios/DiveWatchApp/Models/DiveSessionSummary.swift`
- `apps/mobile/ios/DiveWatchApp/Recording/SafetyStopController.swift`
- `apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift`
- `apps/mobile/ios/DiveWatchApp/Views/SessionDetailView.swift`
- `apps/mobile/__tests__/unsupported-depth.test.ts`
- `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
- `apps/mobile/__tests__/planning-screen.test.tsx`
- `apps/mobile/__tests__/watch-sync-message-validation.test.ts`
- `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
- `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`

Behavior captured for wiki:

- Apple Watch based v1 support is still 40m and below.
- Depth values above 40m are not rejected or clamped. They are preserved for review and planning with an unsupported-depth warning.
- Manual Logbook and Planbook inputs can remain above 40m but render warning copy.
- Imported watch sessions render an unsupported-depth marker when explicit `unsupportedDepth` metadata exists or when samples/summary exceed 40m.
- Watch sessions include optional `unsupportedDepth` sync metadata with limit, max depth, first exceeded time, and whether the threshold was exceeded.
- Watch recording shows a restrained "Outside supported depth" warning while current depth is above 40m.
- v1 safety stop remains a recommendation/reminder, not a mandatory decompression stop. Contract compatibility keeps existing `safetyStop.required`, and new optional `safetyStop.recommendationType: "recommended"` records the product meaning.
- Mobile runtime validation accepts `unsupportedDepth` metadata and recommendation-only safety stop metadata, while rejecting malformed unsupported-depth objects and unsupported mandatory recommendation types.
- WatchConnectivity coverage now includes missing `payloadId` event payloads and open-session to ended-session dedupe behavior, but physical disconnect/reconnect crash reproduction remains a real-device validation task.
