# Local Log Import Performance and Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guest claim의 15-item 반복 검사와 Watch 대형 artifact의 JS blocking/head-of-line failure를 제거하면서 기존 데이터 보존·ACK·Supabase publication 경계를 유지한다.

**Architecture:** Claim profile bytes는 file-backed raw sidecar로 옮기고 exact guest cleanup은 entity별 한 번의 conditional bulk mutation으로 처리한다. iOS Watch inbox는 utility queue에서 full artifact를 검증하고 bounded preview와 opaque prepared-profile identity만 JS에 전달하며, JS drain은 payload별 실패를 격리한다.

**Tech Stack:** React Native 0.85.3, TypeScript, Jest, AsyncStorage 3.1.1, Swift/Foundation/CryptoKit, WatchConnectivity, React Native native modules, Yarn 1.

## Global Constraints

- Supabase schema, migration, RLS, Edge Function과 remote payload digest contract를 변경하지 않는다.
- Watch JSON Schema/generated output과 Watch sender를 변경하지 않는다.
- Watch import ACK는 iPhone local metadata와 full profile commit 완료만 뜻한다.
- Guest source는 remote finalize/readback과 account local publication/readback 전 삭제하지 않는다.
- Existing schema 1 claim snapshot과 inline `payloadJson` Watch payload를 계속 지원한다.
- Yarn 1 lockfile만 사용하고 새 dependency를 추가하지 않는다.
- 모든 production behavior 변경은 RED test를 먼저 실행한다.

---

### Task 1: Conditional Bulk Delete Repository Boundary

**Files:**
- Create: `apps/mobile/src/repositories/bulk-conditional-delete.ts`
- Modify: `apps/mobile/src/repositories/dive-log-repository.ts`
- Modify: `apps/mobile/src/repositories/dive-plan-repository.ts`
- Modify: `apps/mobile/src/repositories/local-dive-log-repository.ts`
- Modify: `apps/mobile/src/repositories/local-dive-plan-repository.ts`
- Modify: `apps/mobile/src/repositories/persistent-dive-log-repository.ts`
- Modify: `apps/mobile/src/repositories/persistent-dive-plan-repository.ts`
- Test: `apps/mobile/__tests__/persistent-dive-log-repository.test.ts`
- Test: `apps/mobile/__tests__/persistent-dive-plan-repository.test.ts`

**Interfaces:**
- Produces:

```ts
export type ConditionalDeleteRequest<T> = {
  localId: string;
  predicate: DeletePredicate<T>;
};

export type ConditionalDeleteManyResult = ReadonlyMap<
  string,
  ConditionalDeleteResult
>;
```

- `DiveLogRepository.deleteManyIf?` accepts requests and `DeleteDiveLogOptions`.
- `DivePlanRepository.deleteManyIf?` accepts requests.
- Persistent implementations read one envelope and write at most one envelope per bulk call.

- [ ] **Step 1: Write failing persistent repository tests**

Add tests that save 15 rows, spy on storage `getString`/`setString`, call one
`deleteManyIf`, and assert:

```ts
expect([...result.values()]).toEqual(
  Array.from({length: 15}, () => 'deleted'),
);
expect(await repository.list()).toEqual([]);
expect(mainEnvelopeWriteCount).toBe(1);
```

Add a mixed predicate test:

```ts
expect(result.get('exact')).toBe('deleted');
expect(result.get('changed')).toBe('conditionFailed');
expect((await repository.list()).map(value => value.localId)).toEqual([
  'changed',
]);
```

- [ ] **Step 2: Run RED repository tests**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  apps/mobile/__tests__/persistent-dive-log-repository.test.ts \
  apps/mobile/__tests__/persistent-dive-plan-repository.test.ts
```

Expected: FAIL because `deleteManyIf` does not exist.

- [ ] **Step 3: Implement generic request/result types and optional interfaces**

Create `bulk-conditional-delete.ts`:

```ts
import type {
  ConditionalDeleteResult,
  DeletePredicate,
} from './conditional-delete';

export type ConditionalDeleteRequest<T> = {
  localId: string;
  predicate: DeletePredicate<T>;
};

export type ConditionalDeleteManyResult = ReadonlyMap<
  string,
  ConditionalDeleteResult
>;
```

Add optional methods to both repository interfaces so external test/custom
repositories retain compatibility.

- [ ] **Step 4: Implement local and persistent bulk mutations**

For persistent repositories:

```ts
async deleteManyIf(
  requests: readonly ConditionalDeleteRequest<DiveLogEntry>[],
  options?: DeleteDiveLogOptions,
): Promise<ConditionalDeleteManyResult> {
  return this.enqueueMutation(async () => {
    options?.assertCanCommit?.();
    const entries = await this.readEntries();
    const requestById = new Map(requests.map(request => [request.localId, request]));
    const results = new Map<string, ConditionalDeleteResult>();
    const nextEntries = entries.filter(entry => {
      const request = requestById.get(entry.localId);
      if (!request) return true;
      if (!request.predicate(cloneDiveLogEntry(entry))) {
        results.set(entry.localId, 'conditionFailed');
        return true;
      }
      results.set(entry.localId, 'deleted');
      return false;
    });
    for (const request of requests) {
      if (!results.has(request.localId)) results.set(request.localId, 'notFound');
    }
    if ([...results.values()].includes('deleted')) {
      await this.writeEntries(nextEntries);
    }
    options?.assertCanCommit?.();
    return results;
  });
}
```

Planbook uses the same single-read/single-write structure. Local repositories
perform the same conditions against their maps and roll back when
`assertCanCommit` fails.

- [ ] **Step 5: Run GREEN repository tests**

Run the Step 2 command.

Expected: both suites PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/mobile/src/repositories \
  apps/mobile/__tests__/persistent-dive-log-repository.test.ts \
  apps/mobile/__tests__/persistent-dive-plan-repository.test.ts
git commit -m "perf(mobile): add conditional bulk local deletes"
```

---

### Task 2: File-Backed Raw Profile Sidecars

**Files:**
- Modify: `apps/mobile/src/storage/watch-profile-storage.ts`
- Modify: `apps/mobile/ios/Divenary/WatchProfileStorageModule.swift`
- Modify: `apps/mobile/ios/Divenary/WatchProfileStorageModuleBridge.m`
- Modify: `apps/mobile/src/claim/guest-claim-store.ts`
- Modify: `apps/mobile/src/claim/guest-claim-service.ts`
- Test: `apps/mobile/__tests__/guest-claim-store.test.ts`
- Test: `apps/mobile/__tests__/guest-claim-service.test.ts`
- Test: `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`

**Interfaces:**
- `WatchProfileStorage` produces raw operations:

```ts
writeRaw(key: string, payloadJson: string): Promise<void>;
readRaw(key: string): Promise<string | undefined>;
copyRaw(sourceKey: string, destinationKey: string): Promise<void>;
```

- `GuestClaimSnapshotItem` accepts either legacy `profileBytes` or schema 2
  `profileSidecarStorageKey`, never both.

- [ ] **Step 1: Write failing raw storage and claim sidecar tests**

Add a claim snapshot test with a 8,000-sample profile:

```ts
expect(snapshot.schemaVersion).toBe(2);
expect(snapshot.snapshots[0]?.profileBytes).toBeUndefined();
expect(snapshot.snapshots[0]?.profileSidecarStorageKey).toMatch(
  /^dive-mobile:claim-profile:/,
);
expect(JSON.stringify(snapshot)).not.toContain('"depthMeters"');
```

Read the sidecar through `profileStorage.readRaw` and verify:

```ts
expect(
  verifyProfileBytesSnapshot(stored!, {
    localSessionId: 'session-a',
    sampleCount: 8_000,
    sha256: snapshot.manifest.items[0]!.profile!.sha256,
  }).sampleCount,
).toBe(8_000);
```

Add native source assertions for `writeRawProfile`, `readRawProfile`,
`copyRawProfile` bridge methods and a non-main utility queue.

- [ ] **Step 2: Run RED sidecar tests**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  apps/mobile/__tests__/guest-claim-store.test.ts \
  apps/mobile/__tests__/guest-claim-service.test.ts \
  apps/mobile/__tests__/watch-connectivity-native-source.test.ts
```

Expected: FAIL because raw profile operations and schema 2 references do not
exist.

- [ ] **Step 3: Add native/fallback raw profile operations**

In Swift, expose:

```swift
@objc(writeRawProfile:payloadJson:resolver:rejecter:)
func writeRawProfile(
  key: String,
  payloadJson: String,
  resolver resolve: @escaping RCTPromiseResolveBlock,
  rejecter reject: @escaping RCTPromiseRejectBlock
) {
  profileQueue.async {
    // UTF-8 and JSON array validation, atomic write, resolve
  }
}

@objc(copyRawProfile:destinationKey:resolver:rejecter:)
func copyRawProfile(
  sourceKey: String,
  destinationKey: String,
  resolver resolve: @escaping RCTPromiseResolveBlock,
  rejecter reject: @escaping RCTPromiseRejectBlock
) {
  profileQueue.async {
    // resolve both keys through profileURL(for:), then atomic replacement
  }
}
```

`readRawProfile` returns the exact stored string. Existing typed `write/read`
delegate to the raw methods. Fallback storage writes/reads the same raw string.

- [ ] **Step 4: Add schema 2 profile sidecar references**

Extend `GuestClaimSnapshotItem`:

```ts
profileSidecarStorageKey?: string;
```

Use a deterministic key:

```ts
function claimProfileSidecarKey(
  userId: string,
  localId: string,
  contentRevision: string,
  sha256: string,
): string {
  return [
    'dive-mobile:claim-profile',
    encodeURIComponent(userId),
    encodeURIComponent(localId),
    encodeURIComponent(contentRevision),
    sha256,
  ].join(':');
}
```

Snapshot creation writes exact profile bytes to this key, reads them back,
verifies byte/sample/digest identity, then persists only the key. Parser accepts
schema 1 inline bytes and schema 2 sidecars with exact-key validation.

- [ ] **Step 5: Materialize profile bytes through one helper**

Add:

```ts
export async function readClaimProfileBytes(
  sidecar: GuestClaimSnapshotItem,
  profileStorage: WatchProfileStorage,
): Promise<string | undefined> {
  if (sidecar.profileBytes !== undefined) return sidecar.profileBytes;
  if (sidecar.profileSidecarStorageKey === undefined) return undefined;
  return profileStorage.readRaw(sidecar.profileSidecarStorageKey);
}
```

Change stage, account publication and source matching to use this helper.
Schema 1 is migrated to schema 2 only after raw sidecar write/readback succeeds.

- [ ] **Step 6: Run GREEN sidecar tests and mobile typecheck**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  apps/mobile/__tests__/guest-claim-store.test.ts \
  apps/mobile/__tests__/guest-claim-service.test.ts \
  apps/mobile/__tests__/watch-connectivity-native-source.test.ts
yarn mobile:typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/mobile/src/storage/watch-profile-storage.ts \
  apps/mobile/ios/Divenary/WatchProfileStorageModule.swift \
  apps/mobile/ios/Divenary/WatchProfileStorageModuleBridge.m \
  apps/mobile/src/claim \
  apps/mobile/__tests__/guest-claim-store.test.ts \
  apps/mobile/__tests__/guest-claim-service.test.ts \
  apps/mobile/__tests__/watch-connectivity-native-source.test.ts
git commit -m "perf(mobile): move claim profiles to file sidecars"
```

---

### Task 3: Bulk Claim Cleanup, Compact Receipt, and Retryable Cleanup Failure

**Files:**
- Modify: `apps/mobile/src/claim/guest-claim-types.ts`
- Modify: `apps/mobile/src/claim/guest-claim-store.ts`
- Modify: `apps/mobile/src/claim/guest-claim-service.ts`
- Modify: `apps/mobile/src/claim/watch-artifact-history.ts`
- Modify: `apps/mobile/src/states/account-data.tsx`
- Test: `apps/mobile/__tests__/guest-claim-service.test.ts`
- Test: `apps/mobile/__tests__/guest-claim-store.test.ts`
- Test: `apps/mobile/__tests__/watch-artifact-history.test.ts`
- Test: `apps/mobile/__tests__/account-data-state.test.tsx`

**Interfaces:**
- `GuestClaimHistoricalArtifact`:

```ts
export type GuestClaimHistoricalArtifact = {
  localSessionId: string;
  contentRevision: string;
  artifactSha256: string;
};
```

- Schema 2 committed receipt has `snapshots: []` and
  `historicalArtifacts: GuestClaimHistoricalArtifact[]`.
- Cleanup failure remains `manifest.status === 'cleanupPending'` with
  `errorCode` and `failure.phase === 'cleanup'`.

- [ ] **Step 1: Write failing cleanup budget and failure tests**

Use 15 logs and 3 plans. Spy on `list`, `deleteManyIf`, `get`, `deleteIf`:

```ts
expect(guest.logbook.deleteManyIf).toHaveBeenCalledTimes(1);
expect(guest.planbook.deleteManyIf).toHaveBeenCalledTimes(1);
expect(guest.logbook.get).not.toHaveBeenCalled();
expect(guest.planbook.get).not.toHaveBeenCalled();
expect(guest.logbook.deleteIf).not.toHaveBeenCalled();
expect(result?.manifest.status).toBe('committed');
```

Add a bulk condition failure test:

```ts
expect(result).toMatchObject({
  manifest: {status: 'cleanupPending'},
  errorCode: 'claim_validation_failed',
  failure: {phase: 'cleanup', clientRecordId: 'changed-during-cleanup'},
});
```

Mount account state twice and assert a cleanup failure is not auto-resumed until
`claim.retry()` is called.

- [ ] **Step 2: Run RED cleanup tests**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  apps/mobile/__tests__/guest-claim-service.test.ts \
  apps/mobile/__tests__/guest-claim-store.test.ts \
  apps/mobile/__tests__/watch-artifact-history.test.ts \
  apps/mobile/__tests__/account-data-state.test.tsx
```

Expected: FAIL because cleanup is item-by-item and cleanup errors are swallowed.

- [ ] **Step 3: Implement inventory-first classification and entity bulk delete**

In `cleanup`:

```ts
const [logs, plans] = await Promise.all([
  guest.logbook.list(),
  guest.planbook.list(),
]);
const logsById = new Map(logs.map(value => [value.localId, value]));
const plansById = new Map(plans.map(value => [value.localId, value]));
```

Classify each snapshot item from these maps. Promote changed rows. Collect exact
delete requests with canonical source predicates. Call `deleteManyIf` once per
entity; use existing item fallback only when the optional method is absent.
Treat every `conditionFailed` as a cleanup failure with the affected item.

- [ ] **Step 4: Remove duplicate profile validation and compact evidence**

After metadata delete, call `removeWatchProfileIfUnreferenced` once per unique
snapshot profile key without re-reading profile bytes.

Before cleanup, schema 2 drops remote payload/profile upload evidence that is no
longer needed. After cleanup:

```ts
snapshot.schemaVersion = 2;
snapshot.snapshots = [];
snapshot.historicalArtifacts = historicalArtifactsFromSnapshot(snapshot);
snapshot.manifest.status = 'committed';
delete snapshot.errorCode;
delete snapshot.failure;
await this.persist(snapshot);
```

Update historical lookup to read `historicalArtifacts` first and legacy
sidecars second.

- [ ] **Step 5: Persist and present cleanup failures without auto-loop**

On cleanup catch:

```ts
const failure = this.serviceError(error);
snapshot.manifest.status = 'cleanupPending';
snapshot.errorCode = failure.code;
snapshot.failure = failure.failure ?? {phase: 'cleanup'};
await this.persist(snapshot);
```

`refreshClaim` automatically resumes `cleanupPending` only when
`snapshot.failure === undefined`. `retry()` clears error/failure before cleanup.

- [ ] **Step 6: Run GREEN cleanup tests**

Run the Step 2 command.

Expected: all four suites PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/mobile/src/claim \
  apps/mobile/src/states/account-data.tsx \
  apps/mobile/__tests__/guest-claim-service.test.ts \
  apps/mobile/__tests__/guest-claim-store.test.ts \
  apps/mobile/__tests__/watch-artifact-history.test.ts \
  apps/mobile/__tests__/account-data-state.test.tsx
git commit -m "perf(mobile): bulk reconcile guest claims"
```

---

### Task 4: Phase-Correct Claim Progress UI

**Files:**
- Modify: `apps/mobile/src/claim/guest-claim-types.ts`
- Modify: `apps/mobile/src/states/account-data.tsx`
- Modify: `apps/mobile/src/screens/account-claim/screen.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Test: `apps/mobile/__tests__/account-claim-screen.test.tsx`
- Test: `apps/mobile/__tests__/account-data-state.test.tsx`

**Interfaces:**
- Upload/finalize running state retains `completed/total`.
- Cleanup running state is:

```ts
{
  status: 'running';
  phase: 'cleanup';
}
```

- [ ] **Step 1: Write failing UI tests**

Render cleanup state and assert:

```ts
expect(root.findByProps({testID: 'account-claim-progress-count'})).toBeFalsy();
expect(textContent(root)).toContain('기기 데이터를 정리하는 중');
expect(root.findByProps({testID: 'account-claim-cleanup-spinner'})).toBeTruthy();
```

Render a cleanup failure and assert retry remains available while no
`15 / 15` import count is shown.

- [ ] **Step 2: Run RED UI tests**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  apps/mobile/__tests__/account-claim-screen.test.tsx \
  apps/mobile/__tests__/account-data-state.test.tsx
```

Expected: FAIL because cleanup uses generic numeric `ProgressContent`.

- [ ] **Step 3: Implement discriminated phase rendering**

In the screen:

```tsx
{claim.state.status === 'running' &&
claim.state.phase === 'cleanup' ? (
  <CleanupContent onClose={() => navigation.goBack()} />
) : null}
```

`CleanupContent` renders title, preservation copy, spinner and close action.
Uploading/finalizing continue to render the numeric depth trace.

Add Korean and English keys:

```ts
cleanupDescription:
  '계정 저장은 완료되었습니다. 이 기기에 남은 원본을 안전하게 정리하고 있습니다.',
cleanupFailureDescription:
  '계정 기록은 보존되어 있습니다. 기기 원본 정리를 다시 시도해 주세요.',
```

- [ ] **Step 4: Run GREEN UI tests**

Run the Step 2 command.

Expected: both suites PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/mobile/src/claim/guest-claim-types.ts \
  apps/mobile/src/states/account-data.tsx \
  apps/mobile/src/screens/account-claim/screen.tsx \
  apps/mobile/src/i18n/resources.ts \
  apps/mobile/__tests__/account-claim-screen.test.tsx \
  apps/mobile/__tests__/account-data-state.test.tsx
git commit -m "fix(mobile): separate claim cleanup progress"
```

---

### Task 5: Native Bounded Watch Artifact Preparation

**Files:**
- Modify: `apps/mobile/ios/Divenary/WatchConnectivityInbox.swift`
- Modify: `apps/mobile/ios/Divenary/WatchConnectivityModule.swift`
- Modify: `apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m`
- Modify: `apps/mobile/ios/Divenary/WatchProfileStorageModule.swift`
- Modify: `apps/mobile/src/native/watch-connectivity.ts`
- Test: `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
- Test: `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`

**Interfaces:**
- Descriptor `WatchConnectivityPayload` makes `payloadJson` optional.
- Native preparation returns:

```ts
export type PreparedWatchConnectivityPayload = WatchConnectivityPayload & {
  payloadJson: string;
  preparedProfile?: {
    payloadId: string;
    sampleCount: number;
    byteCount: number;
    sha256: string;
  };
};
```

- Native methods:
  `preparePendingPayload(payloadId)` and
  `adoptPreparedProfile(payloadId, destinationKey)`.

- [ ] **Step 1: Write failing native boundary tests**

Assert source contracts:

```ts
expect(inbox).toContain('.prefix(8)');
expect(inbox).toContain('func preparePendingPayload(');
expect(inbox).toContain('preparePendingPayloadOnStateQueue');
expect(inbox).toContain('makePeakPreservingPreview');
expect(inbox).toContain('preparedProfileFilePath');
expect(inbox).not.toMatch(
  /var descriptorDictionary[\\s\\S]*payloadJson/,
);
expect(module).toContain('@objc(preparePendingPayload:resolver:rejecter:)');
expect(bridge).toContain('preparePendingPayload');
expect(bridge).toContain('adoptPreparedProfile');
```

Add a JS test where a descriptor without `payloadJson` calls an injected
`preparePendingPayload` exactly once.

- [ ] **Step 2: Run RED native boundary tests**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  apps/mobile/__tests__/watch-connectivity-native-source.test.ts \
  apps/mobile/__tests__/watch-connectivity-sync.test.tsx
```

Expected: FAIL because descriptors still carry full JSON and native prepare
methods do not exist.

- [ ] **Step 3: Return bounded descriptor batches**

Replace `prefix(1)` with `prefix(8)` and return `descriptorDictionary` containing
only payload ID, session/revision/artifact digest and received timestamp.
Notification events also post only the descriptor.

- [ ] **Step 4: Implement utility-queue preparation**

`preparePendingPayloadOnStateQueue`:

```swift
let data = try payload.artifactData()
try verifyArtifact(data, payload: payload)
guard var message = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      var session = message["session"] as? [String: Any],
      let samples = session["samples"] as? [[String: Any]] else {
  throw WatchPayloadPreparationError.invalidPayload
}
try validate(samples: samples, localSessionId: payload.localSessionId)
let profileData = try JSONSerialization.data(withJSONObject: samples)
let preview = makePeakPreservingPreview(samples, limit: 160)
session["samples"] = preview
message["session"] = session
```

Atomically persist `profileData`, store its path and digest fields on the
pending record, persist pending payload metadata, and return bounded JSON plus
prepared profile metadata.

- [ ] **Step 5: Implement opaque profile adoption**

Resolve `payloadId` only against `pendingPayloads`. Copy the prepared file to
`WatchProfileStorageModule.profileURL(for: destinationKey)` atomically. Do not
delete the prepared source until inbox acknowledgement so retry remains safe.

- [ ] **Step 6: Add TypeScript bridge wrappers**

Export:

```ts
export async function preparePendingWatchConnectivityPayload(
  payload: WatchConnectivityPayload,
): Promise<PreparedWatchConnectivityPayload> {
  if (payload.payloadJson !== undefined) return {...payload, payloadJson: payload.payloadJson};
  if (!payload.payloadId || !nativeModule?.preparePendingPayload) {
    throw new WatchPayloadPreparationError('unavailable');
  }
  return nativeModule.preparePendingPayload(payload.payloadId);
}
```

Expose an error classifier so invalid native payloads are drop-acknowledged and
I/O failures remain pending.

- [ ] **Step 7: Run GREEN native boundary tests and iOS build**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  apps/mobile/__tests__/watch-connectivity-native-source.test.ts \
  apps/mobile/__tests__/watch-connectivity-sync.test.tsx
yarn ios:build
```

Expected: tests PASS and iOS build exits 0.

- [ ] **Step 8: Commit Task 5**

```bash
git add apps/mobile/ios/Divenary/WatchConnectivityInbox.swift \
  apps/mobile/ios/Divenary/WatchConnectivityModule.swift \
  apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m \
  apps/mobile/ios/Divenary/WatchProfileStorageModule.swift \
  apps/mobile/src/native/watch-connectivity.ts \
  apps/mobile/__tests__/watch-connectivity-native-source.test.ts \
  apps/mobile/__tests__/watch-connectivity-sync.test.tsx
git commit -m "perf(ios): prepare watch artifacts off the JS thread"
```

---

### Task 6: Prepared Profile Repository Import and Failure Isolation

**Files:**
- Modify: `apps/mobile/src/storage/watch-profile-storage.ts`
- Modify: `apps/mobile/src/repositories/dive-log-repository.ts`
- Modify: `apps/mobile/src/repositories/persistent-dive-log-repository.ts`
- Modify: `apps/mobile/src/repositories/local-dive-log-repository.ts`
- Modify: `apps/mobile/src/states/watch-connectivity-sync.tsx`
- Modify: `apps/mobile/src/states/use-dive-logbook.ts`
- Test: `apps/mobile/__tests__/persistent-dive-log-repository.test.ts`
- Test: `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
- Test: `apps/mobile/__tests__/logbook-manual-entry.test.tsx`

**Interfaces:**
- `ImportWatchMessagesOptions.preparedProfiles`:

```ts
preparedProfiles?: Array<
  | {
      payloadId: string;
      sampleCount: number;
      byteCount: number;
      sha256: string;
    }
  | undefined
>;
```

- Manual summary adds `failedCount`.

- [ ] **Step 1: Write failing prepared import test**

Pass a 160-sample preview and prepared metadata with `sampleCount: 8_000`.
Mock `profileStorage.adoptPrepared` and spy on `createWatchProfileDigest`.

```ts
expect(profileStorage.adoptPrepared).toHaveBeenCalledWith(
  'payload-large',
  expect.stringContaining('session-large'),
);
expect(saved.watchCapture?.profile?.sampleCount).toBe(8_000);
expect(saved.watchCapture?.samples).toHaveLength(160);
expect(createWatchProfileDigest).not.toHaveBeenCalled();
```

- [ ] **Step 2: Write failing failed-first/valid-second drain test**

Return two descriptors. Make the first repository import reject and the second
succeed:

```ts
expect(summary).toEqual({
  receivedCount: 2,
  importedCount: 1,
  failedCount: 1,
});
expect(acknowledgeImportedPayloads).toHaveBeenCalledWith(['second']);
expect(acknowledgeImportedPayloads).not.toHaveBeenCalledWith(['first']);
```

- [ ] **Step 3: Run RED prepared import tests**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  apps/mobile/__tests__/persistent-dive-log-repository.test.ts \
  apps/mobile/__tests__/watch-connectivity-sync.test.tsx \
  apps/mobile/__tests__/logbook-manual-entry.test.tsx
```

Expected: FAIL because prepared profile adoption and failed count do not exist.

- [ ] **Step 4: Implement prepared repository branch**

When a prepared profile exists:

```ts
const profileDigest = {
  byteCount: prepared.byteCount,
  sha256: prepared.sha256,
};
await this.profileStorage.adoptPrepared!(
  prepared.payloadId,
  profileStorageKey,
);
const previewSamples = message.session.samples;
```

Validate `prepared.sampleCount >= previewSamples.length`,
`message.session.profile?.sampleCount === prepared.sampleCount`, and SHA grammar.
Fallback messages keep the current full sample digest/write/preview path.

- [ ] **Step 5: Prepare descriptors before strict JS validation**

Inject/default `preparePendingPayload` in provider/manual options. The native
bounded JSON still goes through `parseWatchSyncMessageJson`. Pass
`preparedProfiles: [prepared.preparedProfile]` to repository import.

- [ ] **Step 6: Isolate payload failures**

Automatic and manual loops catch each payload separately:

```ts
for (const payload of freshPayloads) {
  try {
    await importPayload(payload);
  } catch (error) {
    if (isInvalidPreparedPayloadError(error)) {
      await acknowledgePayload(payload, acknowledgePayloads);
    } else {
      failedCount += 1;
    }
    continue;
  }
}
```

Continue draining until no fresh IDs remain. Preserve stale-principal error
semantics by rethrowing stale coordinator errors.

- [ ] **Step 7: Update manual action result handling**

Return `failedCount` without discarding successful imports. Logbook UI uses
existing failure copy when `failedCount > 0 && importedCount === 0`; partial
success reports imported count and leaves failed payloads retryable.

- [ ] **Step 8: Run GREEN prepared import tests**

Run the Step 3 command.

Expected: all suites PASS.

- [ ] **Step 9: Commit Task 6**

```bash
git add apps/mobile/src/storage/watch-profile-storage.ts \
  apps/mobile/src/repositories \
  apps/mobile/src/states/watch-connectivity-sync.tsx \
  apps/mobile/src/states/use-dive-logbook.ts \
  apps/mobile/__tests__/persistent-dive-log-repository.test.ts \
  apps/mobile/__tests__/watch-connectivity-sync.test.tsx \
  apps/mobile/__tests__/logbook-manual-entry.test.tsx
git commit -m "fix(mobile): isolate and bound watch imports"
```

---

### Task 7: Durable Wiki Evidence and Full Verification

**Files:**
- Create: `.wiki/raw/architecture/2026-07-28-local-log-import-performance-reliability.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`
- Modify: `docs/2026-07-19-guest-data-account-claim-device-checklist.md`

**Interfaces:**
- Documents the three durability boundaries: Watch local history, iPhone inbox
  ACK, guest claim cleanup/account publication.

- [ ] **Step 1: Capture implementation evidence in raw wiki**

Use the Karpathy raw header:

```md
Source URL: repository implementation and verification, 2026-07-28
Collected: 2026-07-28
Published: 2026-07-28
```

Record bulk cleanup, sidecar schema compatibility, native prepared import,
failure isolation, tests and unverified physical gates without transient debug
logs or user identifiers.

- [ ] **Step 2: Compile durable sync-flow knowledge**

Update `.wiki/wiki/architecture/sync-flow.md` sources/raw/Updated fields and
describe:

- claim profile bytes are file-backed;
- cleanup is bulk conditional and compact receipt-based;
- cleanup errors require explicit retry;
- native Watch preparation returns bounded preview;
- failed inbox entries do not block later entries;
- ACK meaning is unchanged.

Update index date and append:

```md
## [2026-07-28] ingest | 동기화 흐름 구조
```

- [ ] **Step 3: Update physical checklist**

Add unchecked gates for:

- 15 old claim rows + 1 new row;
- 8,000-sample import during tab presses;
- failed-first/valid-second inbox;
- cold launch three times with cleanup checkpoint;
- Release configuration observation.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  apps/mobile/__tests__/guest-claim-store.test.ts \
  apps/mobile/__tests__/guest-claim-service.test.ts \
  apps/mobile/__tests__/account-data-state.test.tsx \
  apps/mobile/__tests__/account-claim-screen.test.tsx \
  apps/mobile/__tests__/persistent-dive-log-repository.test.ts \
  apps/mobile/__tests__/persistent-dive-plan-repository.test.ts \
  apps/mobile/__tests__/watch-artifact-history.test.ts \
  apps/mobile/__tests__/watch-connectivity-native-source.test.ts \
  apps/mobile/__tests__/watch-connectivity-sync.test.tsx
yarn mobile:typecheck
yarn workspace @repo/mobile test --runInBand
yarn ios:build
yarn watch:build
yarn codex:check
```

Expected: every command exits 0. Simulator service warnings are environment
warnings only when the build exits 0.

- [ ] **Step 5: Review final diff against the design**

Check:

```bash
git diff --check
git status --short
git diff --stat HEAD~6..HEAD
```

Confirm no dependency/lockfile, Supabase migration, Watch schema/generated
contract, bundle ID, signing or entitlement changes.

- [ ] **Step 6: Commit documentation**

```bash
git add .wiki docs/2026-07-19-guest-data-account-claim-device-checklist.md
git commit -m "docs: record local log import hardening"
```

- [ ] **Step 7: Request code review and address findings**

Use `requesting-code-review` with the design, this plan, base SHA `9206115` and
current HEAD. Fix every Critical/Important issue with a new RED/GREEN cycle,
then rerun the affected focused tests and the final verification gate.
