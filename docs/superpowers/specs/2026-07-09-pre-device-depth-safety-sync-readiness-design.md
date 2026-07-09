# Pre-Device Depth Safety Sync Readiness Design

## Context

The project is ready to move from simulator-oriented watch/mobile proof of concept work toward Apple Watch real-device validation. The remaining pre-device work is not a new product mode. It is a hardening pass that makes known limitations explicit before pool testing:

- Apple Watch based v1 support is limited to 40m, but current mobile Logbook and Planbook forms still allow 60m with no warning.
- Values deeper than 40m must be preserved when entered manually or captured by the watch, but they must not look like normal Apple Watch supported depth.
- v1 scuba safety stop is a recommended non-certified reminder, while existing contract/model naming still contains `safetyStop.required`.
- WatchConnectivity already has a durable inbox and acknowledgement path, but disconnect/reconnect testing needs stronger automated coverage and clearer manual drain behavior before physical validation.

This app remains a recreational dive log companion. It is not a certified dive computer, decompression computer, medical device, life-support device, emergency decision system, or certified equipment replacement.

## Goals

- Preserve manual, planned, and watch-captured depth values above 40m.
- Mark any depth above 40m as outside Apple Watch v1 supported depth.
- Show compact warning copy in mobile Logbook, Planbook, and watch recording when 40m is exceeded.
- Keep all raw watch samples, including samples above 40m.
- Add a structured watch sync marker so imported watch logs keep the unsupported-depth fact.
- Separate v1 safety-stop recommendation wording from future mandatory/decompression wording.
- Harden automatic and manual WatchConnectivity imports against duplicate payloads, missing payload ids, open-session updates, and repository failures.
- Leave actual underwater sensor behavior, auto-launch, background delivery, and pairing as real-device validation items.

## Non-Goals

- Do not reject Logbook or Planbook saves solely because depth exceeds 40m.
- Do not delete, clamp, cap, or rewrite raw watch depth samples above 40m.
- Do not implement decompression obligation, tissue loading, NDL, ceiling, TTS, CNS, gas remaining, no-fly, gas switching, emergency instructions, or certified dive-computer behavior.
- Do not add Supabase, authentication, cloud sync, or backend retry semantics.
- Do not redesign the whole Logbook, Planbook, Settings, or Watch UI.
- Do not add a new UI framework or dependency.

## Decisions

- Depth policy: choose "preserve plus unsupported marker" instead of rejection. Manual logs, plans, and watch sessions can represent depths above 40m, but UI must say the value is outside Apple Watch v1 supported depth.
- Warning tone: use a low-chroma warning marker, not critical emergency styling. The copy should be visible but not visually louder than actual critical alerts would be in a future certified workflow.
- Contract policy: add optional structured `unsupportedDepth` metadata to the watch session contract. Legacy payloads without the field remain valid.
- Manual mobile policy: derive unsupported-depth state from stored planned/manual values instead of forcing a broad mobile storage migration in this pass.
- Safety-stop policy: keep `safetyStop.required` for compatibility, add optional `recommendationType: "recommended"` metadata, and stop exposing `required` to users as "Required" or "필수".
- Sync policy: keep the existing durable inbox semantics. Payloads are acknowledged only after valid import or intentional invalid-payload drop; repository failures remain retryable.

## Depth Limit Model

Define the same product constant in the relevant layers:

```ts
SUPPORTED_WATCH_DEPTH_LIMIT_METERS = 40
```

Swift should define the equivalent constant in watch source. The constant represents Apple Watch v1 supported depth scope, not a physics limit or safety threshold.

### Watch Sync Contract

Add an optional `unsupportedDepth` object to `WatchSession`:

```json
{
  "unsupportedDepth": {
    "exceeded": true,
    "limitMeters": 40,
    "maxDepthMeters": 42.3,
    "firstExceededAt": 1781352600
  }
}
```

Rules:

- `unsupportedDepth` is optional for backward compatibility.
- `exceeded` is required inside the object.
- `limitMeters` is required and should be `40` for this pass.
- `maxDepthMeters` is optional but should be present when known.
- `firstExceededAt` is optional and should be the first sample timestamp above 40m when known.
- The validator accepts this field and rejects unknown extra fields inside it.
- Generated TypeScript and Swift outputs are regenerated from schema changes.

### Mobile Manual And Plan Data

Manual Logbook and Planbook values do not need a new persisted field for this pass. A helper should compute unsupported depth from:

- `DiveLogEntry.manual.measuredValues.maxDepthMeters`
- `DiveLogEntry.watchCapture.measuredValues.maxDepthMeters`
- `DiveLogEntry.watchCapture.session.unsupportedDepth`
- `DivePlan.plannedValues.plannedMaxDepthMeters`

The helper returns a small review model such as:

```ts
{
  exceeded: boolean;
  limitMeters: 40;
  maxDepthMeters?: number;
  source: "manual" | "watch" | "planned";
}
```

This keeps stored local data stable while giving UI and tests one shared interpretation.

## Mobile UX

### Logbook Editor

The current max-depth validation keeps the existing 60m technical form limit for this pass, but 40m is no longer treated as a save blocker. If the entered max depth exceeds 40m, show helper warning copy near the max-depth field:

English:

> Outside Apple Watch v1 supported depth. The value is saved for review, but not treated as supported watch depth or safety guidance.

Korean:

> Apple Watch v1 지원 수심을 초과합니다. 값은 리뷰용으로 저장되지만 지원 수심이나 안전 판단으로 취급하지 않습니다.

The warning does not block save.

### Planbook Editor

The planned max-depth field follows the same behavior. Plans above 40m can be saved and sent only as planning context. The warning must not imply the watch will safely support that dive.

### Lists And Details

Logbook row/detail and Plan detail show a compact marker when unsupported depth is present. The marker should use a subdued warning tone and concise copy such as:

- `Outside watch support`
- `지원 수심 밖`

Detail screens can show the longer copy. The row marker should not look like a primary button.

### Imported Watch Logs

Watch imports preserve `watchCapture.session.unsupportedDepth`. If the field is missing but samples or summary exceed 40m, mobile review helper still marks the log as outside supported depth.

## Watch UX And Model

### Recording

Watch recording observes current depth and max depth. When current depth exceeds 40m:

- show a compact warning band or line near the live instrument;
- keep the current depth readable;
- avoid critical emergency styling;
- use copy such as "Outside supported depth" / "지원 수심 밖";
- do not tell the user what to do underwater.

This warning is a product support boundary, not a decompression, emergency, ascent, or equipment instruction.

### Stored Session

`DiveSessionRecord` computes unsupported-depth metadata from samples and summary:

- `exceeded` true when any sample or session max depth exceeds 40m;
- `limitMeters` 40;
- `maxDepthMeters` from session max depth;
- `firstExceededAt` from the first sample above 40m when available.

The record persists this metadata and includes it in `syncMessageData()`. Legacy saved records without the field decode successfully.

## Safety Stop Wording

The v1 safety stop remains a recommended non-certified reminder. Existing `safetyStop.required` compatibility remains for existing generated contract and old payloads, but user-facing surfaces should stop presenting it as mandatory.

Changes:

- Watch Summary and Session Detail rename the `Required` row to recommendation-oriented copy, or remove the row if status already communicates the recommendation.
- Mobile Logbook detail uses `Recommended safety stop` and status labels already in the non-certified reminder vocabulary.
- Add optional `recommendationType: "recommended"` to the safety stop record. The field is recommendation-only and must not be used for decompression semantics.
- `required`, `mandatory`, `decompression stop`, and `감압 정지` remain forbidden for v1 safety-stop UX.

Future decompression stop data must be a separate entity with source provenance and explicit product approval. This implementation does not add it.

## WatchConnectivity Hardening

The existing flow stays in place:

1. Native iOS stores received WatchConnectivity payloads in a durable inbox.
2. React Native drains pending payloads on app startup and via the Logbook `워치 동기화` action.
3. Valid payloads go through runtime contract validation and repository import.
4. Invalid payloads are dropped and native-acknowledged.
5. Successfully imported payloads send imported acknowledgement back to the watch.
6. Repository failures do not acknowledge the payload, so a later drain can retry.

Add coverage and small hardening around real-device preconditions:

- Duplicate native payloads from event and drain dedupe to one repository row while acknowledging each durable payload id.
- Payloads without `payloadId` are safe for live message import and never crash acknowledgement.
- Open sessions without `endedAt` and later ended sessions have explicit import-key behavior tests.
- Manual Logbook `워치 동기화` uses the same import function as automatic startup import.
- Final log save failure keeps source plan untouched and leaves payload retryable.
- Source plan completion failure does not undo an already saved watch log import.

No new cloud-sync status is introduced. Mobile visible cloud status remains `pending` for non-local watch logs because there is still no backend.

## Testing

Focused tests:

- Contract fixtures validate after adding optional `unsupportedDepth`.
- Runtime validator accepts and rejects `unsupportedDepth` shape correctly.
- Generated TypeScript and Swift outputs reflect schema changes.
- Logbook editor allows depth above 40m and shows warning.
- Planbook editor allows depth above 40m and shows warning.
- Logbook list/detail and Plan detail show compact unsupported-depth markers.
- Watch source tests or source-contract tests confirm the 40m constant, recording warning copy, and sync payload marker.
- Watch safety-stop source tests confirm user-facing `Required` copy is removed or replaced.
- WatchConnectivity import tests cover duplicate drain/event payloads, missing payload ids, open-to-ended session behavior, and repository failure acknowledgement behavior.

Verification gates:

- `yarn check:quick`
- focused mobile Jest tests for validation, Logbook, Planbook, and WatchConnectivity sync
- `yarn mobile:typecheck`
- `yarn workspace @repo/mobile watch:ui:check`
- `yarn watch:build`
- `yarn codex:check` if the local environment permits

## Wiki Updates After Implementation

After implementation, update `.wiki/raw/` and compiled `.wiki/wiki/` articles because this changes sync behavior, domain model, and safety wording.

Required wiki updates:

- `.wiki/wiki/architecture/implementation-priorities.md`
- `.wiki/wiki/questions/open-questions.md`
- `.wiki/wiki/architecture/sync-flow.md`
- `.wiki/wiki/architecture/watch-app.md`
- `.wiki/wiki/domains/dive-log.md`
- `.wiki/wiki/domains/safety-rules.md`
- `.wiki/wiki/domains/diving-app-scuba-mode.md`
- `.wiki/wiki/domains/diving-app-non-negotiable-safety-rules.md`

Move the 40m policy from "undecided reject/store/marker" to "preserve values with unsupported marker and warning." Keep real underwater sensor behavior, auto-launch, haptics, background delivery, pairing, and pool validation as unresolved until tested on hardware.

## Implementation Order

1. Add shared depth-limit helpers and mobile warnings.
2. Add watch unsupported-depth detection and warning.
3. Add schema field and regenerate contracts.
4. Update validators, fixtures, and import mapping for unsupported-depth and safety-stop recommendation metadata.
5. Replace safety-stop required wording.
6. Add WatchConnectivity hardening tests and small import-path fixes.
7. Run gates and update wiki.
