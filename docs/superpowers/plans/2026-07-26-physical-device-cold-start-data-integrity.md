# Physical Device Cold Start and Data Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make physical-device cold start responsive and loss-safe by recovering transient location startup, moving Watch/account work off interaction-critical paths, and preventing unreadable local Logbook/Planbook bytes from ever being replaced by empty/cloud-only data.

**Architecture:** Durable Logbook/Planbook stores use explicit fail-closed read policy, exact-byte quarantine, and a recoverable pending/commit journal. Watch inbox reconciliation imports every new artifact but acknowledges exact artifacts retained only in inactive claim history without recreating deleted rows. Cold-start weather, native WatchConnectivity and account hydration use bounded retry and interaction-aware serial scheduling while preserving existing sync contracts.

**Tech Stack:** React Native 0.85.3, React 19.2.3, TypeScript, Jest, React Query, AsyncStorage, Swift, WatchConnectivity, Core Location, Supabase typed repositories.

## Global Constraints

- Work on the ordinary branch `codex/physical-device-cold-start-integrity`; do not create a worktree.
- Preserve all pre-existing user changes, especially watchOS source, `Divenary.xcodeproj/project.pbxproj`, cache manifests and the existing underwater device checklist.
- Do not change Supabase schema, migrations, RLS, Storage paths, Edge Functions or generated database types.
- Do not change generated watch contract output directly.
- A Watch imported acknowledgement continues to mean mobile local repository persistence only; it never means account cloud sync completion.
- Current UI layout and visual design remain unchanged.
- Deleted inactive-checkpoint items are not automatically restored and are never counted as live device inventory.
- Every new Watch artifact is imported exactly once; there is no fixed item-count limit.
- Weather/location remains contextual information and must not be described as a dive-safety recommendation.
- No new dependency or lockfile change.
- Use Yarn 1 workspace commands only.
- Follow strict TDD: add the focused regression test, run it and observe the expected failure, then change production code.

---

### Task 1: Fail-closed Logbook and Planbook persistence

**Files:**
- Modify: `apps/mobile/src/storage/persistent-json-store.ts`
- Modify: `apps/mobile/src/repositories/persistent-dive-log-repository.ts`
- Modify: `apps/mobile/src/repositories/persistent-dive-plan-repository.ts`
- Modify: `apps/mobile/src/repositories/principal-repositories.ts`
- Modify: `apps/mobile/src/states/account-data.tsx`
- Modify: `apps/mobile/__tests__/persistent-json-store.test.ts`
- Modify: `apps/mobile/__tests__/persistent-dive-log-repository.test.ts`
- Modify: `apps/mobile/__tests__/persistent-dive-plan-repository.test.ts`
- Modify: `apps/mobile/__tests__/account-data-state.test.tsx`

**Interfaces:**
- Produces: `PersistentJsonReadError`, `PersistentJsonRecoveryError`, `PersistentJsonStoreOptions.readFailurePolicy`, `PersistentJsonStoreOptions.recoveryKeys`.
- Produces: selected principal repositories that are read-verified before publication.
- Consumes: `PersistentKeyValueStore`, `@noble/hashes/sha256`, existing envelope migration functions.

- [ ] **Step 1: Add failing exact-byte preservation tests**

Add tests with these behaviors:

```ts
it('throws and preserves malformed durable bytes instead of returning the default', async () => {
  const storage = new InMemoryPersistentKeyValueStore();
  const raw = '{"schemaVersion":3,"updatedAt":1,"value":[';
  await storage.setString('logbook', raw);
  const store = createStore(storage, {
    readFailurePolicy: 'throw',
    recoveryKeys: {
      pending: 'logbook:pending',
      commit: 'logbook:commit',
      quarantinePrefix: 'logbook:quarantine:',
    },
  });

  await expect(store.read()).rejects.toBeInstanceOf(PersistentJsonReadError);
  await expect(storage.getString('logbook')).resolves.toBe(raw);
});

it('does not replace unreadable local logbook bytes when a save follows', async () => {
  const storage = new InMemoryPersistentKeyValueStore();
  const raw = '{"schemaVersion":99,"updatedAt":1,"value":[]}';
  await storage.setString('principal-logbook', raw);
  const repository = new PersistentDiveLogRepository({
    storage,
    storageKey: 'principal-logbook',
  });

  await expect(repository.save(makeDiveLogEntry())).rejects.toBeInstanceOf(
    PersistentJsonReadError,
  );
  await expect(storage.getString('principal-logbook')).resolves.toBe(raw);
});
```

Add journal crash-boundary cases:

```ts
it.each([
  'after-pending',
  'after-commit',
  'after-main',
] as const)('recovers deterministically when interrupted %s', async boundary => {
  const fixture = await createInterruptedJournalFixture(boundary);
  const result = await fixture.store.read();
  expect(result).toEqual(fixture.expected);
  expect(await fixture.storage.getString(fixture.mainKey))
    .toBe(fixture.expectedMainBytes);
});
```

In `account-data-state.test.tsx`, seed an invalid user Logbook and assert:

```ts
expect(screen.getByTestId('recovery-screen-accountData')).toBeTruthy();
expect(remote.listLogs).not.toHaveBeenCalled();
expect(remote.listPlans).not.toHaveBeenCalled();
expect(storage.getString(userLogbookKey)).resolves.toBe(invalidRaw);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
yarn workspace @repo/mobile test --runInBand \
  __tests__/persistent-json-store.test.ts \
  __tests__/persistent-dive-log-repository.test.ts \
  __tests__/persistent-dive-plan-repository.test.ts \
  __tests__/account-data-state.test.tsx
```

Expected: new tests fail because durable reads still return defaults, journal recovery does not exist, and account bootstrap starts remote work without a successful principal read.

- [ ] **Step 3: Add typed fail-closed reads and recovery journal**

Add these public types:

```ts
export type PersistentJsonRecoveryKeys = {
  pending: string;
  commit: string;
  quarantinePrefix: string;
};

export class PersistentJsonReadError extends Error {
  constructor(
    readonly key: string,
    readonly cause: Error,
  ) {
    super(`Failed to read durable JSON for ${key}`);
    this.name = 'PersistentJsonReadError';
  }
}

export class PersistentJsonRecoveryError extends Error {
  constructor(readonly key: string, message: string) {
    super(message);
    this.name = 'PersistentJsonRecoveryError';
  }
}
```

Extend `PersistentJsonStoreOptions<T>`:

```ts
readFailurePolicy?: 'default' | 'throw';
recoveryKeys?: PersistentJsonRecoveryKeys;
```

Use exact UTF-8 SHA-256 for quarantine and journal digests:

```ts
function digest(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)));
}

type JournalMarker = {
  schemaVersion: 1;
  digest: string;
  byteCount: number;
};

function byteCount(value: string): number {
  return utf8ToBytes(value).length;
}
```

Before a durable read, recover only a fully committed pending value:

```ts
private async recoverCommittedWrite(): Promise<void> {
  if (!this.recoveryKeys) {
    return;
  }
  const markerRaw = await this.storage.getString(this.recoveryKeys.commit);
  if (markerRaw === undefined) {
    return;
  }
  const pending = await this.storage.getString(this.recoveryKeys.pending);
  const marker = parseJournalMarker(markerRaw);
  if (
    pending === undefined ||
    byteCount(pending) !== marker.byteCount ||
    digest(pending) !== marker.digest
  ) {
    throw new PersistentJsonRecoveryError(
      this.key,
      `Invalid committed JSON journal for ${this.key}`,
    );
  }
  await this.storage.setString(this.key, pending);
  if ((await this.storage.getString(this.key)) !== pending) {
    throw new PersistentJsonRecoveryError(
      this.key,
      `Failed JSON journal readback for ${this.key}`,
    );
  }
  await this.storage.remove(this.recoveryKeys.commit);
  await this.storage.remove(this.recoveryKeys.pending);
}
```

On parse/migration failure, preserve raw bytes and throw only when requested:

```ts
private async handleReadError(raw: string, error: unknown): Promise<T> {
  const cause = toError(error);
  this.onReadError?.(cause);
  if (this.readFailurePolicy !== 'throw') {
    return this.defaultValue();
  }
  if (this.recoveryKeys) {
    const quarantineKey = `${this.recoveryKeys.quarantinePrefix}${digest(raw)}`;
    if ((await this.storage.getString(quarantineKey)) === undefined) {
      await this.storage.setString(quarantineKey, raw);
    }
    if ((await this.storage.getString(quarantineKey)) !== raw) {
      throw new PersistentJsonRecoveryError(
        this.key,
        `Failed JSON quarantine readback for ${this.key}`,
      );
    }
  }
  throw new PersistentJsonReadError(this.key, cause);
}
```

Journal durable writes:

```ts
const serialized = JSON.stringify(envelope);
if (!this.recoveryKeys) {
  await this.storage.setString(this.key, serialized);
  return;
}
await this.storage.setString(this.recoveryKeys.pending, serialized);
if ((await this.storage.getString(this.recoveryKeys.pending)) !== serialized) {
  throw new PersistentJsonRecoveryError(this.key, 'Pending write readback failed');
}
await this.storage.setString(
  this.recoveryKeys.commit,
  JSON.stringify({
    schemaVersion: 1,
    digest: digest(serialized),
    byteCount: byteCount(serialized),
  } satisfies JournalMarker),
);
await this.storage.setString(this.key, serialized);
if ((await this.storage.getString(this.key)) !== serialized) {
  throw new PersistentJsonRecoveryError(this.key, 'Main write readback failed');
}
await this.storage.remove(this.recoveryKeys.commit);
await this.storage.remove(this.recoveryKeys.pending);
```

Enable this policy in Logbook/Planbook with keys derived from the exact principal storage key:

```ts
readFailurePolicy: 'throw',
recoveryKeys: {
  pending: `${storageKey}:journal:pending:v1`,
  commit: `${storageKey}:journal:commit:v1`,
  quarantinePrefix: `${storageKey}:quarantine:v1:`,
},
```

App preferences do not pass these options and retain default fallback behavior.

- [ ] **Step 4: Verify selected principal repositories before publication**

After `createPrincipalRepositories` and before setting `publishedRef`:

```ts
async function verifyPrincipalRepositories(
  repositories: PrincipalRepositories,
): Promise<void> {
  await Promise.all([
    repositories.logbook.list(),
    repositories.planbook.list(),
  ]);
}
```

For account publication, verify both the account base and guest repositories before constructing the composed surface. If any read throws, let the existing outer bootstrap catch publish `recoveryRequired/localRepository`; do not create a coordinator, reconcile outbox or start claim inspection.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: all focused suites pass; new regression tests prove exact main bytes survive read failure and remote methods are not invoked.

- [ ] **Step 6: Commit Task 1**

```bash
git add \
  apps/mobile/src/storage/persistent-json-store.ts \
  apps/mobile/src/repositories/persistent-dive-log-repository.ts \
  apps/mobile/src/repositories/persistent-dive-plan-repository.ts \
  apps/mobile/src/repositories/principal-repositories.ts \
  apps/mobile/src/states/account-data.tsx \
  apps/mobile/__tests__/persistent-json-store.test.ts \
  apps/mobile/__tests__/persistent-dive-log-repository.test.ts \
  apps/mobile/__tests__/persistent-dive-plan-repository.test.ts \
  apps/mobile/__tests__/account-data-state.test.tsx
git commit -m "fix(mobile): fail closed on unreadable local data"
```

### Task 2: Recover transient cold-start location failures

**Files:**
- Modify: `apps/mobile/src/conditions/location-service.ts`
- Modify: `apps/mobile/src/conditions/use-home-conditions.ts`
- Create: `apps/mobile/__tests__/location-service.test.ts`
- Modify: `apps/mobile/__tests__/home-conditions-controller.test.tsx`

**Interfaces:**
- Produces: `createLocationService(options)` with injectable native request and delay.
- Produces: one logical Home conditions request that starts only while AppState is active.
- Consumes: existing `LocationService` and `LocationResult`.

- [ ] **Step 1: Add failing transient-error and AppState tests**

Add a real location-service test:

```ts
it('retries transient POSITION_UNAVAILABLE and returns the next position', async () => {
  const request = jest
    .fn()
    .mockImplementationOnce((_success, failure) =>
      failure({code: 2, message: 'location unknown'}),
    )
    .mockImplementationOnce(success =>
      success(makeGeolocationPosition(37.1, 127.1)),
    );
  const service = createLocationService({
    getCurrentPosition: request,
    wait: async () => undefined,
  });

  await expect(service.getCurrentLocation()).resolves.toEqual({
    status: 'ready',
    coordinates: {latitude: 37.1, longitude: 127.1},
  });
  expect(request).toHaveBeenCalledTimes(2);
});
```

Add bounded and permission cases:

```ts
it('stops after three transient attempts', async () => {
  const request = jest.fn((_success, failure) =>
    failure({code: 2, message: 'location unknown'}),
  );
  const service = createLocationService({
    getCurrentPosition: request,
    wait: async () => undefined,
  });
  await expect(service.getCurrentLocation()).resolves.toMatchObject({
    status: 'unavailable',
  });
  expect(request).toHaveBeenCalledTimes(3);
});

it('does not retry permission denial', async () => {
  const request = jest.fn((_success, failure) =>
    failure({code: 1, message: 'denied'}),
  );
  const service = createLocationService({
    getCurrentPosition: request,
    wait: async () => undefined,
  });
  await expect(service.getCurrentLocation()).resolves.toEqual({
    status: 'permissionDenied',
  });
  expect(request).toHaveBeenCalledTimes(1);
});
```

In the controller suite, mock initial AppState `inactive`, mount, assert zero location calls, emit `active`, then assert exactly one call.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
yarn workspace @repo/mobile test --runInBand \
  __tests__/location-service.test.ts \
  __tests__/home-conditions-controller.test.tsx
```

Expected: `createLocationService` is absent and the controller starts while inactive.

- [ ] **Step 3: Implement bounded transient location retry**

Use these exact defaults:

```ts
const TRANSIENT_RETRY_DELAYS_MS = [250, 750] as const;
const POSITION_UNAVAILABLE = 2;

export type LocationServiceFactoryOptions = {
  getCurrentPosition: typeof Geolocation.getCurrentPosition;
  wait?: (milliseconds: number) => Promise<void>;
};
```

Wrap one native callback as a Promise and retry only code 2:

```ts
for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
  const result = await requestCurrentPosition(getCurrentPosition);
  if (result.status !== 'transientUnavailable') {
    return result;
  }
  const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];
  if (delay === undefined) {
    return {
      status: 'unavailable',
      errorMessage: result.errorMessage,
    };
  }
  await wait(delay);
}
```

Map code 1 directly to `permissionDenied`, code 2 to the internal transient result, and all other codes to final `unavailable`.

- [ ] **Step 4: Gate the initial request on active AppState**

In `useHomeConditions`, replace unconditional mount loading with:

```ts
React.useEffect(() => {
  if (AppState.currentState === 'active') {
    void loadConditions();
  }
}, [loadConditions]);
```

Keep the existing active-transition listener and locale single-flight so the transition cannot create a second logical request while the first is running.

- [ ] **Step 5: Run focused weather tests and verify GREEN**

Run the command from Step 2, then:

```bash
yarn workspace @repo/mobile test --runInBand \
  __tests__/home-conditions-provider.test.ts \
  __tests__/home-conditions.test.tsx
```

Expected: all location and Home conditions suites pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add \
  apps/mobile/src/conditions/location-service.ts \
  apps/mobile/src/conditions/use-home-conditions.ts \
  apps/mobile/__tests__/location-service.test.ts \
  apps/mobile/__tests__/home-conditions-controller.test.tsx
git commit -m "fix(mobile): recover cold-start location requests"
```

### Task 3: Reconcile inactive claim history with pending Watch artifacts

**Files:**
- Create: `apps/mobile/src/claim/watch-artifact-history.ts`
- Create: `apps/mobile/__tests__/watch-artifact-history.test.ts`
- Modify: `apps/mobile/src/states/account-data.tsx`
- Modify: `apps/mobile/src/states/watch-connectivity-sync.tsx`
- Modify: `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
- Modify: `apps/mobile/__tests__/account-data-state.test.tsx`

**Interfaces:**
- Produces: `WatchArtifactIdentity`.
- Produces: `claimSnapshotContainsHistoricalArtifact(snapshot, identity, liveGuestIds)`.
- Produces: `AccountDataContextValue.isHistoricalWatchArtifact(identity): Promise<boolean>`.
- Consumes: parsed `GuestClaimSnapshot`, exact guest inventory and Watch payload metadata.

- [ ] **Step 1: Add failing identity and two-payload tests**

Test pure identity matching:

```ts
it('matches an exact inactive checkpoint artifact whose live guest source is gone', () => {
  expect(
    claimSnapshotContainsHistoricalArtifact(
      makeFailedClaimSnapshot({artifactSha256: 'a'.repeat(64)}),
      {
        localSessionId: 'session-1',
        contentRevision: 'revision-1',
        artifactSha256: 'a'.repeat(64),
      },
      new Set(),
    ),
  ).toBe(true);
});

it.each(['localSessionId', 'contentRevision', 'artifactSha256'] as const)(
  'does not match when %s differs',
  field => {
    const identity = makeIdentity();
    identity[field] = `${identity[field]}-different`;
    expect(
      claimSnapshotContainsHistoricalArtifact(
        makeFailedClaimSnapshot(),
        identity,
        new Set(),
      ),
    ).toBe(false);
  },
);
```

Test provider behavior with two pending payloads:

```ts
it('acknowledges one historical duplicate and imports the other new payload', async () => {
  const duplicate = makePayload({sessionId: 'old-session'});
  const fresh = makePayload({sessionId: 'new-session'});
  const acknowledgeImported = jest.fn().mockResolvedValue(undefined);
  renderProvider({
    pending: [duplicate, fresh],
    isHistoricalWatchArtifact: async identity =>
      identity.localSessionId === 'old-session',
    acknowledgeImported,
  });

  await waitFor(() => expect(repository.list()).resolves.toHaveLength(1));
  expect((await repository.list())[0]?.watchCapture?.session.localSessionId)
    .toBe('new-session');
  expect(acknowledgeImported).toHaveBeenCalledWith([duplicate.payloadId]);
  expect(acknowledgeImported).toHaveBeenCalledWith([fresh.payloadId]);
});
```

Add a separate case proving two fresh payloads create two rows.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
yarn workspace @repo/mobile test --runInBand \
  __tests__/watch-artifact-history.test.ts \
  __tests__/watch-connectivity-sync.test.tsx \
  __tests__/account-data-state.test.tsx
```

Expected: history helper/context method do not exist and the historical payload is currently re-imported.

- [ ] **Step 3: Implement exact historical identity matching**

Define:

```ts
export type WatchArtifactIdentity = {
  localSessionId: string;
  contentRevision: string;
  artifactSha256: string;
};
```

Only non-running snapshots may provide historical identity:

```ts
const historicalStatuses = new Set([
  'deferred',
  'failed',
  'retained',
  'cleanupPending',
  'committed',
]);
```

For each manifest item, skip it when `liveGuestIds` contains `clientRecordId`. Parse the paired snapshot local record, require a Watch capture, then compare:

```ts
const profile = record.watchCapture?.profile;
return (
  record.watchCapture?.session.localSessionId === identity.localSessionId &&
  profile?.contentRevision === identity.contentRevision &&
  (profile?.artifactSha256 ?? profile?.sha256) === identity.artifactSha256
);
```

Do not match incomplete identity or a running/finalizing checkpoint.

- [ ] **Step 4: Expose cached account history lookup**

Add to `AccountDataContextValue`:

```ts
isHistoricalWatchArtifact(
  identity: WatchArtifactIdentity,
): Promise<boolean>;
```

Store a publication-scoped `historicalArtifactLookup` Promise cache. On first lookup:

1. return false for guest principal or absent claim store;
2. read current guest logs once and build their local-ID set;
3. read the owned claim snapshot;
4. build an exact artifact identity Set with `claimSnapshotContainsHistoricalArtifact`;
5. cache it for the publication generation.

Clear the cache from the claim service `onSnapshot` callback and after any live guest inventory mutation.

- [ ] **Step 5: Reconcile before repository import**

Extend Watch provider/import options:

```ts
isHistoricalWatchArtifact?: (
  identity: WatchArtifactIdentity,
) => Promise<boolean>;
yieldToRuntime?: () => Promise<void>;
```

After parsing the payload and before repository import:

```ts
const identity = watchArtifactIdentity(result.message, payload);
if (
  identity !== undefined &&
  (await isHistoricalWatchArtifact?.(identity)) === true
) {
  guard.assertActive();
  await acknowledgePayload(payload, acknowledgeImportedPayloads);
  return undefined;
}
```

Historical acknowledgement must not call `notifyImportedEntry`, mutate React Query, enqueue account outbox work or recreate a row.

Use `accountData?.isHistoricalWatchArtifact` as the provider default.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: exact historical artifacts are acknowledged without a row; all new artifacts are imported.

- [ ] **Step 7: Commit Task 3**

```bash
git add \
  apps/mobile/src/claim/watch-artifact-history.ts \
  apps/mobile/src/states/account-data.tsx \
  apps/mobile/src/states/watch-connectivity-sync.tsx \
  apps/mobile/__tests__/watch-artifact-history.test.ts \
  apps/mobile/__tests__/watch-connectivity-sync.test.tsx \
  apps/mobile/__tests__/account-data-state.test.tsx
git commit -m "fix(mobile): reconcile historical watch artifacts"
```

### Task 4: Remove cold-start work from interaction-critical queues

**Files:**
- Modify: `apps/mobile/ios/Divenary/WatchConnectivityInbox.swift`
- Modify: `apps/mobile/ios/Divenary/WatchConnectivityModule.swift`
- Modify: `apps/mobile/src/states/watch-connectivity-sync.tsx`
- Modify: `apps/mobile/src/states/account-data.tsx`
- Modify: `apps/mobile/src/sync/account-sync-coordinator.ts`
- Modify: `apps/mobile/__tests__/watch-connectivity-native-source.test.ts`
- Modify: `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`
- Modify: `apps/mobile/__tests__/account-data-state.test.tsx`
- Modify: `apps/mobile/__tests__/account-sync-coordinator.test.ts`

**Interfaces:**
- Produces: asynchronous native inbox methods with completion handlers.
- Produces: `scheduleAfterInteractions` and `yieldToRuntime` boundaries for automatic Watch drain and initial cloud hydration.
- Consumes: Task 3 historical reconciliation callback.

- [ ] **Step 1: Add failing scheduler and native queue tests**

In Watch provider tests inject:

```ts
const scheduled = createControlledAfterInteractionsScheduler();
renderProvider({
  scheduleAfterInteractions: scheduled.schedule,
  pending: [makePayload()],
});
expect(drainPendingPayloads).not.toHaveBeenCalled();
await scheduled.flush();
await waitFor(() => expect(drainPendingPayloads).toHaveBeenCalled());
```

Assert two imported payloads call `yieldToRuntime` between payloads.

In account state tests assert initial remote list methods are not called until the controlled after-interactions scheduler flushes, while local rows are already rendered. Assert explicit `refreshCloudData()` starts immediately.

In coordinator tests inject `yieldToRuntime` and assert it is called between hydrated rows without changing changed/failure counts.

Update native source assertions to require:

```ts
expect(inbox).toContain(
  'DispatchQueue(label: "com.divenary.watch-connectivity-inbox"',
);
expect(inbox).not.toContain('DispatchQueue.main.sync');
expect(module).toContain('drainPendingPayloads { payloads in');
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
yarn workspace @repo/mobile test --runInBand \
  __tests__/watch-connectivity-native-source.test.ts \
  __tests__/watch-connectivity-sync.test.tsx \
  __tests__/account-data-state.test.tsx \
  __tests__/account-sync-coordinator.test.ts
```

Expected: auto work starts before scheduler flush, no runtime yield exists, and native inbox still uses main-sync file work.

- [ ] **Step 3: Move native inbox state and file materialization to a serial queue**

Add:

```swift
private let stateQueue = DispatchQueue(
  label: "com.divenary.watch-connectivity-inbox",
  qos: .utility
)
```

Convert public methods to async completion form:

```swift
func drainPendingPayloads(
  completion: @escaping ([[String: Any]]) -> Void
) {
  stateQueue.async { [weak self] in
    let payloads = self?.pendingPayloads
      .prefix(1)
      .map(\.dictionary)
      .filter { !$0.isEmpty } ?? []
    completion(payloads)
  }
}

func acknowledge(
  payloadIds: [String],
  completion: @escaping () -> Void
) {
  stateQueue.async { [weak self] in
    self?.acknowledgeOnStateQueue(payloadIds: payloadIds)
    completion()
  }
}
```

Apply the same ownership boundary to imported acknowledge, incoming enqueue, pending acknowledgement mutation, planned-dive persistence, linked-watch reads and persistence. Every public method that previously used `DispatchQueue.main.sync` becomes a `stateQueue` completion method. File `String(contentsOfFile:)`, JSON encode and UserDefaults write must occur on `stateQueue`.

When posting the React event, finish `payload.dictionary` on `stateQueue`, then:

```swift
DispatchQueue.main.async {
  NotificationCenter.default.post(
    name: .diveWatchSyncPayloadReceived,
    object: self,
    userInfo: dictionary
  )
}
```

Keep only this small event delivery on main.

Update the module:

```swift
func drainPendingPayloads(
  resolve: @escaping RCTPromiseResolveBlock,
  rejecter reject: @escaping RCTPromiseRejectBlock
) {
  WatchConnectivityInbox.shared.drainPendingPayloads { payloads in
    resolve(payloads)
  }
}
```

Resolve acknowledge promises only after state-queue persistence completes.

- [ ] **Step 4: Schedule automatic Watch drain after interactions and yield between payloads**

Extend provider props:

```ts
scheduleAfterInteractions?: (
  task: () => void | Promise<void>,
) => {cancel(): void};
yieldToRuntime?: () => Promise<void>;
```

Defaults:

```ts
scheduleAfterInteractions: task => {
  const handle = InteractionManager.runAfterInteractions(task);
  return {cancel: () => handle.cancel()};
},
yieldToRuntime: () =>
  new Promise(resolve => {
    setTimeout(resolve, 0);
  }),
```

Subscribe to native events immediately, but schedule the mount drain. Cancel its handle on unmount. AppState active drain uses the same scheduler. Manual `importPendingWatchConnectivityPayloads` remains immediate.

After each fresh payload except the final one:

```ts
await yieldToRuntime();
```

- [ ] **Step 5: Schedule initial cloud hydration and yield between remote rows**

Add `yieldToRuntime?: () => Promise<void>` to `AccountSyncCoordinatorOptions`, defaulting to a zero-delay timer Promise. Call it after each attempted remote row when another row remains.

In `AccountDataProvider`, publish verified local repositories first. Schedule only the automatic initial `coordinator.hydrate()`/`drain()` block with `dependencies.scheduleAfterInteractions`. Keep `refreshCloudData` immediate and preserve existing cloud single-flight/generation guards.

Track and cancel the scheduled handle on principal change/unmount. Cancellation must settle the internal operation rather than leave `cloudRefresh.promise` pending.

- [ ] **Step 6: Add privacy-safe slow-stage measurements**

Create a local helper inside each affected module:

```ts
async function measureSlowStage<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    const durationMs = performance.now() - startedAt;
    if (__DEV__ && durationMs >= 100) {
      console.warn(`[performance] ${label} ${Math.round(durationMs)}ms`);
    }
  }
}
```

Labels may contain only fixed stage names such as `watch-import`, `account-hydrate-row`, and `location-attempt`. Do not include coordinates, local/session/user IDs, payload labels, site names or notes.

For Swift, use `ContinuousClock` or `CFAbsoluteTimeGetCurrent()` and log only fixed stage plus duration in DEBUG builds.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: all suites pass and source assertions prove no main-sync inbox path.

- [ ] **Step 8: Run iOS compile gate and commit Task 4**

```bash
yarn mobile:typecheck
yarn ios:build
```

Expected: both commands succeed.

Commit only Task 4 files:

```bash
git add \
  apps/mobile/ios/Divenary/WatchConnectivityInbox.swift \
  apps/mobile/ios/Divenary/WatchConnectivityModule.swift \
  apps/mobile/src/states/watch-connectivity-sync.tsx \
  apps/mobile/src/states/account-data.tsx \
  apps/mobile/src/sync/account-sync-coordinator.ts \
  apps/mobile/__tests__/watch-connectivity-native-source.test.ts \
  apps/mobile/__tests__/watch-connectivity-sync.test.tsx \
  apps/mobile/__tests__/account-data-state.test.tsx \
  apps/mobile/__tests__/account-sync-coordinator.test.ts
git commit -m "fix(mobile): prioritize interaction during cold start"
```

### Task 5: Record durable architecture and complete verification

**Files:**
- Create: `.wiki/raw/architecture/2026-07-26-physical-device-cold-start-data-integrity.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/architecture/mobile.md`
- Modify: `.wiki/wiki/architecture/profile-file-sync.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`
- Modify: `docs/superpowers/specs/2026-07-26-physical-device-cold-start-data-integrity-design.md`
- Modify: `docs/superpowers/plans/2026-07-26-physical-device-cold-start-data-integrity.md`

**Interfaces:**
- Consumes: implemented behavior and actual verification output from Tasks 1–4.
- Produces: durable wiki description and final evidence.

- [ ] **Step 1: Capture immutable implementation evidence**

Create the raw page using the repository raw template with:

```md
Source URL: docs/superpowers/specs/2026-07-26-physical-device-cold-start-data-integrity-design.md
Collected: 2026-07-26
Published: 2026-07-26

# Physical device cold start and data integrity

실기기 cold start에서 Core Location의 일시적 `POSITION_UNAVAILABLE`을
최종 실패로 처리하던 경로를 bounded retry로 바꾼다. Logbook과 Planbook의
durable JSON 검증 실패는 빈 배열 fallback을 사용하지 않고 exact raw
quarantine과 recovery-required 상태로 전환한다. Remote hydration, outbox
reconciliation과 claim cleanup은 selected principal의 local repository
검증이 끝난 뒤에만 시작한다.

WatchConnectivity pending artifact는 `localSessionId`, `contentRevision`,
artifact `sha256` identity로 처리한다. Inactive claim history의 exact
artifact이고 live guest source가 없으면 삭제된 row를 다시 만들지 않고
imported acknowledgement만 보낸다. 새 artifact는 개수 제한 없이 모두
local commit 뒤 acknowledge한다.

iOS native inbox의 file materialization, JSON encode와 UserDefaults write는
전용 serial queue에서 실행한다. 자동 Watch drain과 account hydration은
local UI publication과 first interactions 뒤 시작하며 payload/remote row
사이에 cooperative yield를 둔다. 이 변경은 Watch local acknowledgement와
account cloud sync 의미를 합치지 않고 Supabase schema, RLS, Storage path와
Watch contract를 변경하지 않는다.

자동 검증은 durable read failure의 exact-byte 보존, journal crash boundary,
두 개의 새 Watch artifact, historical duplicate와 새 artifact 조합,
transient location recovery, interaction scheduler ordering, native off-main
source boundary를 포함한다. 실기기 검증은 cold launch 3회, sync 중 tab과
logout 입력, pending inbox reconciliation을 별도 확인한다.
```

- [ ] **Step 2: Update compiled wiki articles**

Update the three architecture articles with these durable facts:

- Logbook/Planbook validation failures are fail-closed and block remote hydration/cleanup.
- Recovery journal and exact-byte quarantine do not count as live inventory.
- Inactive claim history can suppress exact Watch retransmission without recreating a deleted row.
- New Watch artifacts remain unlimited and exactly-once by identity.
- Watch native file/UserDefaults work is serial off-main.
- Automatic Watch drain and account hydration run after first interactions and yield cooperatively.
- Cold-start Core Location code 2 is bounded-retry context logic, not a safety signal.

Set `Updated: 2026-07-26`, add the raw source link, update each index summary, and append:

```md
## [2026-07-26] ingest | Physical device cold start and data integrity
- Updated: 모바일 구조
- Updated: 동기화 흐름 구조
- Updated: 1Hz 프로파일 파일 저장과 동기화
```

- [ ] **Step 3: Run complete relevant verification**

```bash
yarn workspace @repo/mobile test --runInBand \
  __tests__/persistent-json-store.test.ts \
  __tests__/persistent-dive-log-repository.test.ts \
  __tests__/persistent-dive-plan-repository.test.ts \
  __tests__/location-service.test.ts \
  __tests__/home-conditions-controller.test.tsx \
  __tests__/home-conditions-provider.test.ts \
  __tests__/watch-artifact-history.test.ts \
  __tests__/watch-connectivity-native-source.test.ts \
  __tests__/watch-connectivity-sync.test.tsx \
  __tests__/account-data-state.test.tsx \
  __tests__/account-sync-coordinator.test.ts
yarn mobile:typecheck
yarn ios:build
yarn codex:check
```

Expected: every command exits zero. Report environment warnings separately and never claim an unrun command passed.

- [ ] **Step 4: Inspect the branch diff and user-owned files**

```bash
git status --short
git diff --check
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Confirm the pre-existing watchOS, Xcode project, cache and underwater checklist modifications are neither staged nor present in branch commits.

- [ ] **Step 5: Commit documentation**

```bash
git add \
  .wiki/raw/architecture/2026-07-26-physical-device-cold-start-data-integrity.md \
  .wiki/wiki/architecture/sync-flow.md \
  .wiki/wiki/architecture/mobile.md \
  .wiki/wiki/architecture/profile-file-sync.md \
  .wiki/wiki/index.md \
  .wiki/wiki/log.md \
  docs/superpowers/specs/2026-07-26-physical-device-cold-start-data-integrity-design.md \
  docs/superpowers/plans/2026-07-26-physical-device-cold-start-data-integrity.md
git commit -m "docs: record physical device data integrity"
```

- [ ] **Step 6: Perform final review and integrate**

Generate the full branch review package from merge base `51fc81f`, dispatch an independent whole-branch reviewer, fix every Critical/Important finding with covering tests, and re-review.

After review is clean:

```bash
git switch main
git merge --ff-only codex/physical-device-cold-start-integrity
git push origin main
```

Do not remove the feature branch or physical-device backup until final verification and the user handoff are complete.
