# Watch Profile File Sync Reliability Design

## Context

`diving-app` records recreational scuba and freedive sessions on Apple Watch and imports them into the iPhone logbook. It is a logging and post-dive review product, not a certified dive computer, decompression computer, medical device, life-support system, or emergency decision system.

The current pipeline has several coupled reliability and scale problems:

- The watch recorder retains every sensor callback in memory and saves all sessions, including all samples, in one JSON array.
- The watch sync contract embeds samples in the session. Small payloads use `sendMessage` plus `transferUserInfo`; only payloads above 48 KiB use `transferFile`.
- The iPhone immediately reads a received WatchConnectivity file back into a JSON string and persists the full string in a UserDefaults inbox.
- Mobile import stores the same samples in both `watchCapture.session.samples` and `watchCapture.samples`, then rewrites the whole logbook through AsyncStorage.
- Mobile can attempt a Watch import acknowledgement before `WCSession` activation finishes, remove the inbound payload without a durable outgoing ACK, and leave the Watch permanently pending.
- Notification preferences hydrate from an initial `false` asynchronously while the sync provider drains immediately, so a valid opt-in can miss its notification.
- The sync provider does not reconcile the durable inbox when the app returns to foreground, and Notifee background press handling is not registered at bootstrap.
- On a physical iPhone, the Settings > Notifications > Watch sync notifications toggle can appear inert. The current code treats a denied permission as a silent `false`, gives no route to system settings, and does not reconcile app preference with OS authorization after returning from Settings. The simulator commonly starts with a fresh, requestable permission state and therefore does not expose the same behavior.

Long sessions are normal: scuba sessions commonly last one to two hours and freedive outings can last three hours. The storage and sync path must handle these sessions without depending on a chunk protocol or storing large payload bodies in UserDefaults/AsyncStorage.

## Goals

- Persist a bounded one-hertz review profile without throttling live sensor consumption.
- Preserve actual measured values, optional temperature semantics, sub-second extrema, and exact session/segment event timestamps.
- Replace the watch monolithic session array with per-session file artifacts and a lightweight manifest.
- Send every completed session payload through one production `WCSession.transferFile` path, regardless of size.
- Copy received files into a durable iPhone inbox before the WatchConnectivity callback returns and persist only small descriptors in UserDefaults.
- Store mobile log metadata separately from sample artifacts and load profiles on demand.
- Make mobile import and Watch acknowledgement crash-safe, revision-aware, durable, and idempotent.
- Eliminate preference-hydration, AppState reconciliation, and notification-press lifecycle races.
- Make the physical-device notification toggle reflect and recover from actual iOS notification authorization.
- Provide deterministic simulator and automated coverage without adding a chunk protocol.
- Document the new storage, transport, acknowledgement, notification, migration, and future Supabase boundaries in the project wiki.

## Non-Goals

- Supabase project creation, authentication, RLS, remote upload, or cloud retry.
- APNs or another remote push provider.
- Guaranteed immediate notification after the user explicitly force-quits the iPhone app.
- Safety-critical depth, ascent, decompression, tissue loading, gas-switching, or emergency decisions.
- Treating simulator transfer behavior as proof of physical WatchConnectivity delivery.
- Compressing profile artifacts in the first implementation. Compact one-hertz JSON remains small enough for the current local and WatchConnectivity scope; compression can be added at a future cloud-upload boundary if measurements justify it.
- A general-purpose file storage framework or speculative shared package.

## Chosen Approach

Use one canonical, immutable session artifact per saved content revision, with lightweight manifests on the Watch and metadata/profile references on mobile.

Raw sensor callbacks continue to drive live display and transient state. A dedicated one-hertz sampler writes a bounded review profile. Every session artifact uses `transferFile`; small session payloads no longer use `sendMessage` or `transferUserInfo`. ACK and planned-dive control traffic remain small WatchConnectivity messages because they have different semantics and do not contain session profiles.

This approach is preferred over:

- Retaining every callback and downsampling only during transfer, which keeps the current memory/storage growth and duplicate-sample problem.
- Throttling the complete recording engine to one hertz, which delays live state and can miss short transitions.
- Adding a chunk protocol for Simulator, which creates ordering, retry, reassembly, timeout, cleanup, and partial-state paths that production `transferFile` does not exercise.

## One-Hertz Capture Policy

### Raw callbacks

Every valid finite sensor callback remains available to:

- current depth and temperature display;
- transient ascent-rate display and non-certified reminder state;
- freedive/scuba live state machines;
- exact event timestamps and running summary accumulators.

Invalid depth, pressure, temperature, or out-of-order values follow the existing sanitizer rules. Missing temperature remains `nil`; the implementation must never synthesize `0°C`.

### Persisted buckets

Buckets are anchored to the session start and cover one-second intervals. A non-empty bucket emits exactly one persisted profile record when the next bucket begins or the session stops. Empty buckets are not filled with synthetic samples.

Each persisted bucket records:

- the last actual sample timestamp and depth as the representative point;
- minimum and maximum depth observed in the bucket;
- the latest valid pressure in the bucket;
- the latest measured temperature in the bucket, if one exists;
- the session identity required by the contract.

The representative point preserves a coherent one-hertz curve while bucket extrema prevent a brief turn or depth peak from disappearing. Exact freedive segment start/end, session start/end, and other already-supported domain events remain timestamped independently from the representative sample cadence. Segment sample ranges are remapped to the finalized persisted profile index space.

### Summary semantics

Final summaries are derived from the same sanitized running state and finalized bucket profile:

- maximum depth uses bucket maxima and exact running maximum;
- average depth uses the one-hertz representative profile so it approximates a time-weighted average;
- temperature averages use only measured values;
- unsupported-depth metadata uses the exact observed maximum and first exact threshold-crossing timestamp;
- final exported summary and profile must agree within deterministic test tolerances.

The stored one-hertz records become the canonical captured review profile. Mobile must preserve them without import-time downsampling or rewriting. UI-only chart downsampling remains render-only.

## Watch Storage Architecture

### Directory layout

The Watch owns an Application Support directory with a small manifest and one directory per local session:

```text
DiveWatchApp/
  session-manifest.json
  Sessions/<local-session-id>/
    recording.ndjson
    session-<content-revision>.json
```

`recording.ndjson` is an append-only working journal containing finalized one-second buckets. The recorder also persists small active-session metadata needed to identify and recover an interrupted recording. It does not continuously rewrite the immutable final artifact.

On normal stop/save, the Watch streams the journal into a compact, schema-valid session artifact, computes byte count and SHA-256, atomically installs the artifact, then atomically updates the manifest. The artifact is immutable and remains the local review/source-of-truth file for that content revision. The working journal can be removed after the artifact and manifest are durable.

### Manifest

The manifest stores no sample arrays. Each entry contains:

- `localSessionId`;
- content revision;
- artifact relative path;
- format/schema version;
- started/ended timestamps and display summary;
- sample interval and count;
- byte count and SHA-256;
- capture/dive mode and lightweight mode summary;
- transfer status and last transport error metadata;
- outstanding/retry state needed to avoid duplicate transfers.

Sync-status or display-summary updates rewrite only the small manifest, never every profile sample.

### Interrupted recording recovery

If the process terminates during recording, the journal and active-session metadata remain. On next launch the store must not delete them as generic orphans. It recovers a reviewable interrupted session ending at the last valid sample/event timestamp, marks it as interrupted provenance rather than a completed normal stop, and lets the user retain or delete it. It must not imply that the complete dive was captured.

### Legacy migration

Existing `savedDiveSessionRecords.json` records migrate one at a time:

1. Decode and sanitize a legacy record.
2. Create its per-session artifact and manifest entry atomically.
3. Verify sample count, identity, metadata, and digest by reading the new artifact.
4. Repeat for all records.
5. Remove the legacy file only after every record and the new manifest are durable.

Failure leaves the legacy source intact and must not erase unrelated sessions. Migration is idempotent across restart.

## Contract And Artifact Format

The schema source under `packages/contracts` remains authoritative. Generated Swift and TypeScript outputs are never edited directly.

The existing `WatchSyncMessage` session artifact remains the transfer validation boundary, but the depth-sample schema gains optional one-second bucket extrema. Session/profile metadata gains explicit fields for:

- sampling interval/version;
- content revision;
- sample count;
- artifact byte count;
- SHA-256 digest;
- interrupted-capture provenance where applicable.

The file metadata supplied to `transferFile` carries only property-list-safe routing and integrity fields: kind, local session ID, content revision, message type, sent timestamp, byte count, SHA-256, and schema/format version. It never carries Base64 profile data.

The digest is calculated over the final immutable artifact bytes. Identity for transfer, import, notification, and ACK is the tuple:

```text
localSessionId + contentRevision + sha256
```

This prevents an ACK for an older artifact from marking newer content as synchronized.

## WatchConnectivity Transport

### Session payloads

Every completed session artifact is queued with `WCSession.transferFile` immediately after local durability, regardless of byte size or reachability. The implementation does not gate session enqueue on `isReachable`.

The sender:

- reuses the immutable artifact rather than creating an ad hoc temporary copy;
- never deletes the local canonical artifact in `didFinish fileTransfer`;
- compares manifest revision/digest with `outstandingFileTransfers` before retrying;
- treats WatchConnectivity transfer completion as transport progress, not mobile import success;
- marks the Watch record `synced` only after a matching application-level ACK arrives.

### Control traffic

Planned-dive application context remains unchanged except for unrelated compatibility adjustments required by shared activation handling.

ACKs use reachable `sendMessage` as a fast path and queued `transferUserInfo` as the durable physical-device path. This does not reintroduce session payload user-info. Simulator tests exercise only the reachable control path; physical-device tests own queued control-delivery evidence.

### Legacy inbound compatibility

For one migration window, the iPhone continues accepting already-outstanding legacy inline watch sync envelopes. It immediately writes the decoded JSON into the same durable file inbox representation used by new file transfers. New Watch code never enqueues session bodies through the inline path.

## iPhone Durable File Inbox

The `WCSessionFile.fileURL` is transient. During the delegate callback, native iOS code must:

1. Validate property-list metadata types and required routing fields.
2. Copy the file atomically into Application Support.
3. Verify byte count and SHA-256 against metadata.
4. Persist a small pending descriptor.
5. Only then notify React Native that content is available.

UserDefaults stores descriptors, not JSON bodies. A descriptor includes payload ID, durable relative path, session/revision/digest identity, received timestamp, byte count, and processing state.

The React Native bridge drains descriptors first and reads one requested artifact at a time. It does not bridge all pending large payloads together. A DEBUG-only fixture injection path can place the same deterministic artifact into the native inbox for Simulator testing; it must not add a production chunk transport or ship in Release behavior.

Corrupt, truncated, or metadata-mismatched files move to a bounded diagnostic quarantine and never receive an import-success ACK. Disk-full or copy failure leaves the Watch pending so it can retry.

## Mobile Profile Repository

AsyncStorage retains logbook metadata and summaries, not sample arrays. `DiveLogWatchCapture` is divided into:

- sample-free session metadata and provenance;
- measured summary values;
- a profile reference containing revision, digest, sample count, interval, and native file handle/relative identifier;
- an optional bounded preview derived from the canonical profile only when needed for list UI.

Import runs as a recoverable transaction:

1. Read and validate one inbox artifact.
2. Determine the stable import key and content identity.
3. Promote/copy the artifact to permanent mobile profile storage idempotently.
4. Save or merge the sample-free logbook metadata referencing that profile.
5. Persist the outgoing ACK intent natively.
6. Remove the inbound descriptor/file only after the ACK intent is durable.

A crash between any steps is recovered by draining the same descriptor again. Stable identities make promotion and repository merge idempotent. Re-delivery of an already-imported revision does not duplicate the log or user-visible notification.

Home and list surfaces use stored summaries. Log detail/profile charts load profile samples asynchronously through a separate repository/query boundary. Deleting a log deletes its referenced profile after the metadata delete is durable. Orphan cleanup removes only files that are neither referenced nor pending; it never guesses during an active migration/import.

Existing mobile AsyncStorage entries migrate by first writing each embedded Watch sample array to a permanent profile file, verifying it, then rewriting the metadata entry without samples. Manual logs without Watch profiles remain unchanged. Migration is versioned, idempotent, and preserves manual/mobile edits, provenance, timestamps, source-plan links, optional temperatures, and cloud status.

## Durable ACK State Machine

The iPhone owns a small native outgoing ACK queue persisted independently from the inbound inbox. Each entry contains the content identity, acknowledged timestamp, enqueue/attempt state, and last error metadata.

Rules:

- ACK intent is created only after profile durability and mobile metadata commit.
- ACK intent is durable before the inbound descriptor is removed.
- ACK transmission waits for `WCSession.activationState == .activated`.
- Activation failure clears the in-progress flag and allows a later retry; errors are logged with domain/code.
- An already-outstanding queued ACK is not duplicated.
- A successful `didFinish userInfoTransfer` removes the durable queued attempt. Reachable send success can remove only the immediate attempt when an equivalent queued transfer is not required; the implementation must retain a retryable intent until one transport path reports success.
- Process restart, reachability change, activation completion, and explicit inbox drain all trigger a safe ACK flush.
- The Watch accepts only a matching revision/digest ACK and leaves newer content pending when a stale ACK arrives.
- Duplicate ACKs are harmless.

If mobile receives the same artifact after it already committed the profile but before the Watch observed the ACK, import becomes a no-op and the ACK is re-enqueued without another toast/notification.

## Notification Lifecycle And Settings Toggle

### Preference hydration

`AppPreferences` gains an explicit hydration state. Automatic notification-capable inbox drain waits for hydration to finish. A storage read failure resolves to defaults and marks hydration complete; it must not leave sync permanently blocked.

The provider subscribes to native events before or independently of hydration so native durability is never lost, but serial import begins only when the preference snapshot is authoritative. On `AppState` transition to `active`, it drains again to reconcile events missed while JavaScript was suspended.

### Presentation policy

- Import while active: one in-app toast for a newly committed content revision.
- Import while background/inactive and notification enabled/authorized: one local notification for that revision.
- Import on a later foreground launch after explicit force-quit: toast, because no background import occurred.
- Duplicate delivery or ACK retry: no additional presentation.
- Notification failure: log the failure but retain the successful import and ACK state.

Notifee background events are registered from `index.js` before rendering React. Notification-open data is persisted/queued until the navigation container is ready; foreground, background, and initial-open paths share one decoder and dedupe identity.

### Physical-device toggle behavior

The setting is the conjunction of the user's app preference and current OS authorization. Enabling follows this state machine:

1. Read `notifee.getNotificationSettings()`.
2. If authorized or provisional, persist the app preference as enabled without requesting again.
3. If not determined, call `requestPermission`, re-read settings, and enable only when authorized/provisional.
4. If denied on iOS, do not fail silently. Explain that iOS no longer shows the system prompt and offer to open the app's system settings with React Native `Linking.openSettings()`; Notifee's `openNotificationSettings()` is Android-only in the installed version.
5. When the app becomes active after visiting Settings, re-read authorization and reconcile the visible toggle and persisted preference.
6. If authorization is later revoked, show the effective toggle as off while preserving clear user-facing guidance rather than claiming notifications are enabled.
7. Disabling always updates the app preference immediately and does not attempt to change the OS-wide permission.

The screen exposes a busy state to prevent double taps while permission/status work is in flight and gives accessible feedback for denied/error states. Simulator and Jest tests cover the state machine, but the final physical-device checklist must verify first request, prior denial, Settings return, revoke, and re-enable behavior.

## Error Handling And Cleanup

- Invalid sensor samples are rejected before journal append; valid neighboring data remains.
- Journal append failure stops claiming successful recording persistence and surfaces a recoverable recording error without fabricating a complete session.
- Artifact finalization uses atomic file replacement; an incomplete final artifact is never added to the manifest.
- Contract validation or checksum failure never produces an import-success ACK.
- Mobile repository failure keeps the inbox descriptor and permanent/staged artifact available for idempotent retry.
- ACK failure does not roll back an imported log; the durable ACK queue retries.
- Notification failure does not roll back import or ACK.
- Legacy migration failure preserves the legacy source and already-verified per-session targets.
- Quarantine and orphan cleanup are bounded and identity-aware.
- Logs include IDs, revisions, byte/sample counts, state transitions, error domain/code, AppState, hydration state, and authorization status. They never include raw profile JSON or private dive notes.

## Testing Strategy

### Watch unit/integration tests

- At most one persisted record per non-empty one-second bucket.
- Last/min/max selection, final bucket flush, no gap synthesis, optional temperature, invalid and out-of-order input.
- Raw callback live state remains responsive while persistent profile is bounded.
- Exact event and finalized profile index mapping.
- Long three-hour fixture, journal reopen, interrupted recovery, and per-session corruption isolation.
- Legacy monolithic migration preserves every sanitized sample and field.
- Streamed artifact validates against generated contract and matches manifest count/bytes/digest.
- Every new session payload selects `transferFile`; no chunk or session body user-info path remains.
- Outstanding transfer dedupe, retry, immutable artifact retention, and revision-matched ACK.

### iPhone native tests

- Transient file is copied before callback completion.
- UserDefaults descriptors never contain payload JSON.
- Digest/size mismatch and disk/write failure behavior.
- Inbox reconstruction across process restart.
- Legacy inline normalization into a file descriptor.
- Durable ACK enqueue-before-inbound-delete ordering.
- Activation gating, activation failure recovery, outstanding ACK dedupe, completion/error retry, and stale ACK isolation.
- DEBUG fixture injection is absent from Release behavior.

### Mobile Jest tests

- Metadata/profile migration removes sample duplication without data loss.
- Profile promotion/import is idempotent across simulated crash boundaries.
- Lazy profile loading and chart rendering preserve canonical samples.
- Same delivery, same revision, new revision, invalid file, and repository failure outcomes.
- Preference hydration gates initial drain and always resolves.
- AppState resume re-drains missed inbox files.
- Foreground toast versus background notification exclusivity and revision dedupe.
- Bootstrap background press, initial notification, and navigation-readiness queue.
- Notification permission state machine: authorized, provisional, not determined granted/denied, prior denial, settings return, revoked permission, busy/error behavior, and disabling.

### Build and repository gates

Run the smallest focused gates first, then the broad handoff gates:

1. Focused Watch XCTest suites.
2. Focused native/mobile Jest suites.
3. Full mobile Jest suite.
4. `yarn check:quick` for contract generation.
5. `yarn mobile:typecheck`.
6. Explicit Watch XCTest command on a Watch simulator destination.
7. `yarn watch:build` and a Release Watch build.
8. `yarn ios:build` when CocoaPods workspace is available.
9. Wiki lint/compile checks required by repository skills.
10. `yarn codex:check`.

Commands not run are never reported as passing.

### Simulator boundary

Simulator tests validate Watch artifact generation and mobile import separately. A DEBUG fixture injects the identical complete artifact into the mobile file inbox. No chunk protocol is added. Simulator success does not prove `transferFile`, queued `transferUserInfo`, background delivery, or force-quit behavior.

### Physical-device matrix

The implementation is not considered physically validated until the paired-device checklist records:

- short scuba/freedive and three-hour-equivalent large artifact transfer;
- foreground, background, ordinary termination/next-launch, offline/reconnect, duplicate, and retry behavior;
- cold-start import with ACK activation race pressure;
- Watch status changing only after matching ACK;
- notification opt-in first request, prior-denial recovery through Settings, revoke/re-enable, background presentation, and press routing;
- no duplicate log, toast, notification, transfer, or ACK for one revision.

Explicit user force-quit remains a documented platform limitation rather than a pass requirement for immediate delivery.

## Wiki And Documentation

Implementation must follow the repository `karpathy-llm-wiki` and `wiki-writing` workflows.

Create new immutable raw sources for:

- one-hertz profile capture and per-session storage;
- file-only Watch session transport and durable iPhone file inbox;
- revision-aware durable ACK and notification lifecycle;
- physical-device notification toggle authorization behavior.

Update compiled knowledge for:

- Watch architecture and storage ownership;
- mobile repository and lazy profile loading;
- sync flow and acknowledgement state machine;
- dive-log sample fidelity and summary semantics;
- Supabase future boundary: metadata table plus private immutable Storage artifact, without implementing Supabase now;
- implementation priorities, QA matrix, open real-device questions, wiki index, and wiki log.

Add an ADR for the canonical one-hertz persistence policy and file-backed sample ownership. Preserve dated historical specs, raw sources, and previous physical verification evidence. Update the active physical checklist, README, and any stale architecture diagrams/text that still claim monolithic sample arrays or hybrid session transport.

## Delivery Workflow

After this design is committed, create a detailed implementation plan. Execute the plan on an isolated feature worktree. Preserve unrelated dirty files in the main checkout. Use test-driven changes, run proportional verification, update the wiki as part of the same feature, review the final diff, merge the completed feature branch into `main`, and report the merge commit plus executed and unexecuted verification evidence.

