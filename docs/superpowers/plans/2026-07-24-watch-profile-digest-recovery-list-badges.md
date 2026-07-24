# Watch Profile Digest Recovery and List Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정상 Apple Watch profile이 로그인 후 손상으로 오인되는 digest 의미 불일치를 고치고, 기존 retained 기록을 보존적으로 복구하며, 목록에서 device-only 데이터와 demo 기록을 명확히 표시한다.

**Architecture:** Watch 전체 artifact digest와 Mobile sample-array digest를 `artifactSha256`과 `sha256`으로 분리한다. 신규 import는 두 digest를 처음부터 올바르게 저장하고, marker가 없는 기존 row만 strict structural validation 뒤 legacy transport digest로 승격한다. UI는 로그인 중 device-only 항목에만 warning badge를, demo watch log에는 독립적인 demo badge를 표시한다.

**Tech Stack:** React Native 0.85.3, TypeScript 5.8, Jest 29, React Test Renderer, `@noble/hashes` 1.8.0, gluestack-ui v4/NativeWind, i18next, Yarn 1.22.22

## Global Constraints

- Yarn 1만 사용하고 lockfile이나 dependency를 변경하지 않는다.
- Supabase schema, migration, RLS, Edge Function, Watch artifact format, Watch ACK 의미는 변경하지 않는다.
- `sha256`은 `JSON.stringify(fullSamples)` UTF-8 bytes의 SHA-256이고 `artifactSha256`은 Watch `sessionEnded` 전체 artifact bytes의 SHA-256이다.
- legacy recovery는 `artifactSha256`이 없는 기존 local row에만 허용한다.
- profile file missing, malformed sample, sample-count mismatch, session mismatch와 versioned digest mismatch는 계속 실패한다.
- guest raw profile samples와 guest source metadata를 복구 과정에서 rewrite하거나 삭제하지 않는다.
- 로그인 중 device-only log/plan만 `이 기기에만 저장` / `Only on this device` badge를 표시한다.
- demo watch log에는 저장 위치와 독립적으로 `데모` / `Demo` badge를 표시한다.
- account row와 signed-out guest row에는 storage-location badge를 표시하지 않는다.
- destructive red를 device-only 상태에 사용하지 않고 semantic warning color와 device icon, text를 함께 사용한다.
- 기존 사용자 미커밋 watch/Xcode 변경을 수정하거나 branch에 포함하지 않는다.
- 구현은 테스트를 먼저 작성하고 예상한 이유로 실패하는 것을 확인한 뒤 production code를 변경한다.

---

### Task 1: Split Watch Artifact and Profile Sample Digests

**Files:**
- Create: `apps/mobile/src/utils/watch-profile-digest.ts`
- Create: `apps/mobile/__tests__/watch-profile-digest.test.ts`
- Modify: `apps/mobile/src/types/dive-log-entry.ts`
- Modify: `apps/mobile/src/repositories/dive-log-repository.ts`
- Modify: `apps/mobile/src/repositories/persistent-dive-log-repository.ts`
- Modify: `apps/mobile/src/states/watch-connectivity-sync.tsx`
- Modify: `apps/mobile/src/claim/profile-bytes.ts`
- Modify: `apps/mobile/__tests__/persistent-dive-log-repository.test.ts`
- Modify: `apps/mobile/__tests__/watch-connectivity-sync.test.tsx`

**Interfaces:**
- Produces: `createWatchProfileDigest(samples: WatchDepthSample[]): { bytes: string; byteCount: number; sha256: string }`
- Produces: `DiveLogWatchCapture.profile.artifactSha256?: string`
- Produces: `ImportWatchMessagesOptions.artifactDigests?: Array<string | undefined>`
- Consumes: native `WatchConnectivityPayload.sha256` as artifact digest only

- [ ] **Step 1: Write failing digest-domain tests**

Add a real sample-array assertion to `watch-profile-digest.test.ts`:

```ts
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import type {WatchDepthSample} from '../src/types/dive-session';
import {createWatchProfileDigest} from '../src/utils/watch-profile-digest';

const samples: WatchDepthSample[] = [{
  localSessionId: 'session-1',
  timestamp: 1_781_000_000,
  depthMeters: 3.2,
}];

it('hashes only the serialized full sample array', () => {
  const expectedBytes = JSON.stringify(samples);
  const expectedSha = bytesToHex(sha256(new TextEncoder().encode(expectedBytes)));

  expect(createWatchProfileDigest(samples)).toEqual({
    bytes: expectedBytes,
    byteCount: new TextEncoder().encode(expectedBytes).length,
    sha256: expectedSha,
  });
});
```

Extend `persistent-dive-log-repository.test.ts` so importing a Watch message with `artifactDigests: ['a'.repeat(64)]` expects:

```ts
expect(saved.watchCapture?.profile).toEqual(expect.objectContaining({
  artifactSha256: 'a'.repeat(64),
  sha256: createWatchProfileDigest(watchMessage.session.samples).sha256,
}));
expect(saved.watchCapture?.profile?.sha256)
  .not.toBe(saved.watchCapture?.profile?.artifactSha256);
```

Extend `watch-connectivity-sync.test.tsx` with a payload whose `sha256` is the full fixture JSON digest and assert the stored profile uses the sample digest while preserving the payload digest in `artifactSha256`.

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH \
yarn workspace @repo/mobile test --runInBand \
  __tests__/watch-profile-digest.test.ts \
  __tests__/persistent-dive-log-repository.test.ts \
  __tests__/watch-connectivity-sync.test.tsx
```

Expected: FAIL because `watch-profile-digest` and `artifactSha256`/`artifactDigests` do not exist and the repository still stores the artifact digest as `profile.sha256`.

- [ ] **Step 3: Implement the canonical sample digest helper**

Create `watch-profile-digest.ts`:

```ts
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import type {WatchDepthSample} from '../types/dive-session';

export type WatchProfileDigest = {
  bytes: string;
  byteCount: number;
  sha256: string;
};

export function createWatchProfileDigest(
  samples: WatchDepthSample[],
): WatchProfileDigest {
  const bytes = JSON.stringify(samples);
  const encoded = new TextEncoder().encode(bytes);
  return {
    bytes,
    byteCount: encoded.length,
    sha256: bytesToHex(sha256(encoded)),
  };
}
```

Refactor `claim/profile-bytes.ts` to call this helper after strict parsing instead of maintaining a second serialization/hash implementation.

- [ ] **Step 4: Store both digest domains during persistent import**

Change the profile reference type:

```ts
profile?: {
  storageKey: string;
  contentRevision: string;
  sampleCount: number;
  sha256?: string;
  artifactSha256?: string;
};
```

Rename the import option:

```ts
export type ImportWatchMessagesOptions = {
  artifactDigests?: Array<string | undefined>;
  assertCanCommit?: () => void;
};
```

In `PersistentDiveLogRepository.importWatchMessages`, calculate the digest from `fullSamples` and persist:

```ts
const profileDigest = createWatchProfileDigest(fullSamples);
profile: {
  storageKey: profileStorageKey,
  contentRevision,
  sampleCount: fullSamples.length,
  sha256: profileDigest.sha256,
  artifactSha256: options?.artifactDigests?.[messageIndex],
},
```

Update `assertWatchCapture` to allow only the new optional key in addition to existing profile keys:

```ts
hasOnlyKeys(value.profile, [
  'storageKey',
  'contentRevision',
  'sampleCount',
  'sha256',
  'artifactSha256',
])
```

Validate both optional digests as non-empty strings without weakening sample/session validation.

- [ ] **Step 5: Use artifact identity for WatchConnectivity duplicate handling**

Pass the native digest using the renamed option:

```ts
await repository.importWatchMessages([result.message], {
  artifactDigests: [payload.sha256],
  assertCanCommit: guard.assertActive,
});
```

Match current and legacy rows:

```ts
function storedArtifactDigest(entry: DiveLogEntry): string | undefined {
  const profile = entry.watchCapture?.profile;
  return profile?.artifactSha256 ?? profile?.sha256;
}
```

Use it only for Watch artifact duplicate identity:

```ts
storedArtifactDigest(entry) === payload.sha256
```

Do not use `artifactSha256` for profile upload or Supabase payload construction.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: PASS for all selected suites.

- [ ] **Step 7: Commit Task 1**

```bash
git add \
  apps/mobile/src/utils/watch-profile-digest.ts \
  apps/mobile/src/types/dive-log-entry.ts \
  apps/mobile/src/repositories/dive-log-repository.ts \
  apps/mobile/src/repositories/persistent-dive-log-repository.ts \
  apps/mobile/src/states/watch-connectivity-sync.tsx \
  apps/mobile/src/claim/profile-bytes.ts \
  apps/mobile/__tests__/watch-profile-digest.test.ts \
  apps/mobile/__tests__/persistent-dive-log-repository.test.ts \
  apps/mobile/__tests__/watch-connectivity-sync.test.tsx
git commit -m "fix: separate watch artifact and profile digests"
```

---

### Task 2: Recover Legacy Digest Metadata Without Rewriting Guest Profiles

**Files:**
- Modify: `apps/mobile/src/claim/profile-bytes.ts`
- Modify: `apps/mobile/src/claim/guest-claim-store.ts`
- Modify: `apps/mobile/src/states/account-data.tsx`
- Modify: `apps/mobile/src/claim/guest-claim-service.ts`
- Modify: `apps/mobile/__tests__/guest-claim-store.test.ts`
- Modify: `apps/mobile/__tests__/guest-claim-service.test.ts`
- Modify: `apps/mobile/__tests__/account-data-state.test.tsx`

**Interfaces:**
- Consumes: `createWatchProfileDigest` and the profile reference created by Task 1
- Produces: `createStoredProfileBytesSnapshot(samples, expectation)` returning verified profile bytes plus normalized `sha256` and optional `artifactSha256`
- Produces: claim/account rows whose local and remote `sha256` always describe sample-array bytes

- [ ] **Step 1: Write failing guest legacy-recovery tests**

In `guest-claim-store.test.ts`, seed a guest Watch log whose stored full samples are valid but whose reference is legacy:

```ts
profile: {
  storageKey: guestProfileKey,
  contentRevision: 'revision-1',
  sampleCount: samples.length,
  sha256: 'a'.repeat(64),
},
```

Assert:

```ts
expect(snapshot.retainedItems).toHaveLength(0);
expect(snapshot.manifest.logCount).toBe(1);
expect(snapshot.manifest.items[0]?.profile).toEqual(expect.objectContaining({
  sha256: createWatchProfileDigest(samples).sha256,
}));
const localSnapshot = JSON.parse(snapshot.snapshots[0]!.localRecordBytes);
expect(localSnapshot.watchCapture.profile).toEqual(expect.objectContaining({
  sha256: createWatchProfileDigest(samples).sha256,
  artifactSha256: 'a'.repeat(64),
}));
expect(await guestLogbook.get(log.localId)).toEqual(log);
expect(await profileStorage.read(guestProfileKey)).toEqual(samples);
```

Add strict negative cases:

```ts
it.each([
  ['missing profile', undefined],
  ['sample count mismatch', wrongCountSamples],
  ['session mismatch', wrongSessionSamples],
])('%s stays retained', async (_name, storedSamples) => {
  // expect retained reason profile_missing/profile_corrupt and remote item count 0
});
```

Add a versioned mismatch row with both `sha256` and `artifactSha256`; expect `profile_corrupt`, proving it is not auto-repaired.

- [ ] **Step 2: Write failing account-outbox legacy-recovery tests**

In `account-data-state.test.tsx`, save an owned account log with a valid profile file, `sha256: 'a'.repeat(64)`, and no `artifactSha256`. Trigger the account mutation preparation and assert the locally saved/outbox payload has:

```ts
profile: expect.objectContaining({
  sha256: createWatchProfileDigest(samples).sha256,
  artifactSha256: 'a'.repeat(64),
})
```

Add a versioned mismatch case and expect the mutation to reject with the existing local profile integrity error.

- [ ] **Step 3: Run recovery tests and verify RED**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH \
yarn workspace @repo/mobile test --runInBand \
  __tests__/guest-claim-store.test.ts \
  __tests__/guest-claim-service.test.ts \
  __tests__/account-data-state.test.tsx
```

Expected: legacy rows are currently retained/rejected because the artifact digest is compared directly with the sample digest.

- [ ] **Step 4: Implement explicit stored-reference normalization**

Add to `profile-bytes.ts`:

```ts
export type StoredProfileBytesSnapshot = ProfileBytesSnapshot & {
  artifactSha256?: string;
};

export function createStoredProfileBytesSnapshot(
  samples: WatchDepthSample[] | undefined,
  expectation: {
    localSessionId: string;
    sampleCount: number;
    sha256?: string;
    artifactSha256?: string;
  },
): StoredProfileBytesSnapshot {
  const snapshot = createProfileBytesSnapshot(samples, {
    localSessionId: expectation.localSessionId,
    sampleCount: expectation.sampleCount,
  });

  if (expectation.artifactSha256 !== undefined) {
    if (
      expectation.sha256 === undefined ||
      expectation.sha256 !== snapshot.sha256
    ) {
      throw new GuestClaimProfileError('profile_corrupt');
    }
    return {...snapshot, artifactSha256: expectation.artifactSha256};
  }

  if (
    expectation.sha256 === undefined ||
    expectation.sha256 === snapshot.sha256
  ) {
    return snapshot;
  }

  return {...snapshot, artifactSha256: expectation.sha256};
}
```

This helper is the only compatibility path. Existing `createProfileBytesSnapshot` and remote readback verification remain strict.

- [ ] **Step 5: Normalize immutable guest claim snapshots**

In `prepareLogSnapshot`, replace strict use of the stored `sha256` with `createStoredProfileBytesSnapshot`, then normalize only the cloned `log`:

```ts
const profile = createStoredProfileBytesSnapshot(
  await profileStorage.read(profileReference.storageKey),
  {
    localSessionId: log.watchCapture.session.localSessionId,
    sampleCount: profileReference.sampleCount,
    sha256: profileReference.sha256,
    artifactSha256: profileReference.artifactSha256,
  },
);

log = {
  ...log,
  watchCapture: {
    ...log.watchCapture,
    profile: {
      ...profileReference,
      sha256: profile.sha256,
      ...(profile.artifactSha256 === undefined
        ? {}
        : {artifactSha256: profile.artifactSha256}),
    },
  },
};
```

Do not call `guestRepository.save` and do not write profile storage during snapshot preparation.

Ensure guest claim publication spreads the normalized profile reference so `artifactSha256` is retained locally but never added to the remote Supabase payload.

- [ ] **Step 6: Normalize legacy account rows before outbox creation**

In `prepareLogMutation`, replace duplicated JSON/hash code with `createStoredProfileBytesSnapshot`. If the normalized reference differs, save the account-local row before constructing the remote payload:

```ts
const snapshot = createStoredProfileBytesSnapshot(samples, {
  localSessionId: saved.watchCapture.session.localSessionId,
  sampleCount: saved.watchCapture.profile.sampleCount,
  sha256: saved.watchCapture.profile.sha256,
  artifactSha256: saved.watchCapture.profile.artifactSha256,
});
const normalizedProfile = {
  ...saved.watchCapture.profile,
  sha256: snapshot.sha256,
  ...(snapshot.artifactSha256 === undefined
    ? {}
    : {artifactSha256: snapshot.artifactSha256}),
};
```

Keep remote profile serialization equal to `snapshot.bytes` and remote digest equal to `snapshot.sha256`.

- [ ] **Step 7: Run recovery tests and verify GREEN**

Run the command from Step 3.

Expected: valid legacy guest/account rows normalize, source guest rows remain byte-for-byte unchanged before commit, and versioned/malformed rows still fail.

- [ ] **Step 8: Commit Task 2**

```bash
git add \
  apps/mobile/src/claim/profile-bytes.ts \
  apps/mobile/src/claim/guest-claim-store.ts \
  apps/mobile/src/states/account-data.tsx \
  apps/mobile/src/claim/guest-claim-service.ts \
  apps/mobile/__tests__/guest-claim-store.test.ts \
  apps/mobile/__tests__/guest-claim-service.test.ts \
  apps/mobile/__tests__/account-data-state.test.tsx
git commit -m "fix: recover legacy watch profile digests"
```

---

### Task 3: Add Quiet Device-Only and Demo Badges to Lists

**Files:**
- Create: `apps/mobile/src/components/ui/list-status-badge.tsx`
- Modify: `apps/mobile/src/components/ui/gluestack-ui-provider/config.ts`
- Modify: `apps/mobile/tailwind.config.js`
- Modify: `apps/mobile/src/screens/logbook/screen.tsx`
- Modify: `apps/mobile/src/screens/planning/screen.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Modify: `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
- Modify: `apps/mobile/__tests__/planning-screen.test.tsx`
- Modify: `apps/mobile/__tests__/i18n.test.ts`
- Modify: `apps/mobile/__tests__/apple-design-system.test.tsx`

**Interfaces:**
- Produces: `<ListStatusBadge kind="demo" | "device" label icon? testID?>`
- Consumes: `entry.watchCapture?.session.captureMode`, `ownerUserId`, and screen-level `isAuthenticated`

- [ ] **Step 1: Write failing Logbook badge tests**

Update the existing authenticated device-row test to expect the new copy:

```ts
expect(deviceBadge.props.children).toContain('Only on this device');
expect(accountBadges).toHaveLength(0);
```

Add list tests:

```ts
it('shows a demo badge on demo watch rows', async () => {
  const renderer = await renderLogbook(
    new LocalDiveLogRepository([demoWatchEntry]),
  );
  expect(renderer.root.findByProps({
    testID: 'logbook-demo-badge-Demo Reef',
  })).toBeTruthy();
});

it('shows demo then device-only badges for retained demo rows', async () => {
  const renderer = await renderLogbook(
    new LocalDiveLogRepository([deviceOnlyDemoEntry]),
    {isAuthenticated: true},
  );
  const badgeRow = renderer.root.findByProps({
    testID: 'logbook-list-badges-Demo Reef',
  });
  expect(badgeRow.props.children.map((child: {props: {label: string}}) =>
    child.props.label)).toEqual(['Demo', 'Only on this device']);
});
```

Keep the existing signed-out assertion: no device-only badge before authentication.

- [ ] **Step 2: Write failing Planbook badge tests**

Update existing device plan copy assertions and add active-plan coverage:

```ts
expect(root.findByProps({
  testID: 'planning-device-badge-Device Plan Reef',
}).props.label).toBe('Only on this device');

expect(root.findByProps({
  testID: 'planning-active-device-badge',
}).props.label).toBe('Only on this device');
```

Assert account plan rows and account active plans have no device badge.

- [ ] **Step 3: Write failing token and i18n tests**

In `i18n.test.ts`:

```ts
expect(i18n.t('accountClaim.deviceBadge')).toBe('이 기기에만 저장');
expect(i18n.t('logbook.demoCapture')).toBe('데모');
```

In `apple-design-system.test.tsx`, assert the light/dark provider config defines `--warning`, Tailwind maps `warning`, and the warning badge uses `bg-warning/10 text-warning`, not destructive red.

- [ ] **Step 4: Run UI tests and verify RED**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH \
yarn workspace @repo/mobile test --runInBand \
  __tests__/logbook-manual-entry.test.tsx \
  __tests__/planning-screen.test.tsx \
  __tests__/i18n.test.ts \
  __tests__/apple-design-system.test.tsx
```

Expected: old copy is `On device`, demo badge is absent from the list, active plan has no device badge, and warning tokens do not exist.

- [ ] **Step 5: Add semantic warning tokens and focused badge component**

Add accessible warning RGB variables:

```ts
light: {
  '--warning': '167 79 0',
},
dark: {
  '--warning': '255 159 10',
},
```

Map the Tailwind color and safelist `warning` with the existing semantic colors:

```js
warning: 'rgb(var(--warning)/<alpha-value>)',
```

Create `ListStatusBadge` using semantic classes:

```tsx
type ListStatusBadgeProps = {
  kind: 'demo' | 'device';
  label: string;
  testID?: string;
};

export function ListStatusBadge(props: ListStatusBadgeProps) {
  const isDevice = props.kind === 'device';
  return (
    <HStack
      testID={props.testID}
      accessibilityLabel={props.label}
      className={
        isDevice
          ? 'self-start items-center rounded-full bg-warning/10 px-2.5 py-1'
          : 'self-start items-center rounded-full bg-muted px-2.5 py-1'
      }>
      {isDevice ? (
        <Icon as={PhoneIcon} size="xs" className="mr-1 text-warning" />
      ) : null}
      <Text
        className={
          isDevice
            ? 'text-xs font-semibold text-warning'
            : 'text-xs font-semibold text-muted-foreground'
        }>
        {props.label}
      </Text>
    </HStack>
  );
}
```

Do not uppercase Korean/English labels and do not use red.

- [ ] **Step 6: Render independent badges in Logbook**

Replace the date-adjacent plain text with a separate wrapping badge row:

```tsx
const isDemo = props.entry.watchCapture?.session.captureMode === 'demo';
const badges = [
  ...(isDemo ? [{kind: 'demo' as const, label: t('logbook.demoCapture')}]: []),
  ...(props.showsDeviceOnlyBadge
    ? [{kind: 'device' as const, label: t('accountClaim.deviceBadge')}]
    : []),
];
```

Render only when non-empty, in the array order. Keep account rows unbadged and preserve the current source icon, date, metrics, and press behavior.

- [ ] **Step 7: Render device-only badge in Planbook rows and active panel**

Pass:

```tsx
showsDeviceOnlyBadge={Boolean(
  props.isAuthenticated && plan.ownerUserId === undefined
)}
```

to both `PlanRow` and `ActivePlanPanel`. Render the same `ListStatusBadge kind="device"` component. Do not introduce a plan demo condition.

- [ ] **Step 8: Update localized copy**

Change:

```ts
deviceBadge: '이 기기에만 저장'
deviceBadge: 'Only on this device'
```

Reuse existing `logbook.demoCapture` (`데모` / `Demo`) so detail and list vocabulary remain consistent.

- [ ] **Step 9: Run UI tests and verify GREEN**

Run the command from Step 4.

Expected: PASS for all selected suites.

- [ ] **Step 10: Commit Task 3**

```bash
git add \
  apps/mobile/src/components/ui/list-status-badge.tsx \
  apps/mobile/src/components/ui/gluestack-ui-provider/config.ts \
  apps/mobile/tailwind.config.js \
  apps/mobile/src/screens/logbook/screen.tsx \
  apps/mobile/src/screens/planning/screen.tsx \
  apps/mobile/src/i18n/resources.ts \
  apps/mobile/__tests__/logbook-manual-entry.test.tsx \
  apps/mobile/__tests__/planning-screen.test.tsx \
  apps/mobile/__tests__/i18n.test.ts \
  apps/mobile/__tests__/apple-design-system.test.tsx
git commit -m "feat: label device-only and demo list rows"
```

---

### Task 4: Record Durable Sync Semantics and Verify the Integrated Change

**Files:**
- Create: `.wiki/raw/architecture/2026-07-24-watch-profile-digest-recovery.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/architecture/mobile.md`
- Modify: `.wiki/wiki/domains/dive-log.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`

**Interfaces:**
- Consumes: verified code and design from Tasks 1–3
- Produces: durable repository knowledge about artifact/profile digest domains, legacy recovery, and list ownership presentation

- [ ] **Step 1: Capture the accepted decision as immutable raw source**

Follow `.agents/skills/karpathy-llm-wiki/references/raw-template.md` under the repository `.wiki/` root. Record:

```md
# Watch Profile Digest Recovery and List Badges

Source: local://docs/superpowers/specs/2026-07-24-watch-profile-digest-recovery-list-badges-design.md
Collected: 2026-07-24
Published: 2026-07-24

## Original Content

[Copy the accepted design without rewriting its decisions.]
```

- [ ] **Step 2: Update the smallest compiled article set**

In Korean:

- `sync-flow.md`: distinguish Watch artifact digest from Mobile profile digest and record the legacy marker rule.
- `mobile.md`: explain that account + deferred guest rows are composed and only device-only exceptions receive a badge.
- `dive-log.md`: document `sha256`, `artifactSha256`, `captureMode`, and that demo is provenance/display metadata rather than a different sync path.

Refresh `Updated: 2026-07-24`, add the raw source link, update index summaries/dates, and append:

```md
## [2026-07-24] ingest | Watch profile digest recovery
- Updated: Mobile architecture
- Updated: Dive log domain
```

- [ ] **Step 3: Run focused integrated tests**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH \
yarn workspace @repo/mobile test --runInBand \
  __tests__/watch-profile-digest.test.ts \
  __tests__/persistent-dive-log-repository.test.ts \
  __tests__/watch-connectivity-sync.test.tsx \
  __tests__/guest-claim-store.test.ts \
  __tests__/guest-claim-service.test.ts \
  __tests__/account-data-state.test.tsx \
  __tests__/logbook-manual-entry.test.tsx \
  __tests__/planning-screen.test.tsx \
  __tests__/i18n.test.ts \
  __tests__/apple-design-system.test.tsx
```

Expected: all selected suites pass with zero failures.

- [ ] **Step 4: Run TypeScript and repository gates**

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH yarn mobile:typecheck
```

Expected: exit 0.

Run the full mobile suite:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH \
yarn workspace @repo/mobile test --runInBand
```

Expected after merge with the user's current watch/Xcode work: 54 suites and 712 tests pass. In the isolated branch, any failure must be compared with the recorded baseline of 12 failures in `watch-connectivity-native-source.test.ts` and `ios-auth-configuration.test.ts`; no new failures are accepted.

Run:

```bash
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH yarn ios:build
PATH=/Users/hongseongbin/.nvm/versions/node/v22.20.0/bin:$PATH yarn codex:check
```

Expected: exit 0 for both after the user's unrelated native work is present on merged `main`. If the isolated branch reproduces only the documented native baseline mismatch, retain the evidence and rerun both gates after local merge before declaring completion.

- [ ] **Step 5: Verify diff hygiene**

Run:

```bash
git diff --check
git status --short
git diff --stat main...HEAD
```

Expected: no whitespace errors; only planned app, test, design/plan, and wiki files are changed; no user watch/Xcode files are included.

- [ ] **Step 6: Commit Task 4**

```bash
git add \
  .wiki/raw/architecture/2026-07-24-watch-profile-digest-recovery.md \
  .wiki/wiki/architecture/sync-flow.md \
  .wiki/wiki/architecture/mobile.md \
  .wiki/wiki/domains/dive-log.md \
  .wiki/wiki/index.md \
  .wiki/wiki/log.md
git commit -m "docs: record watch profile digest semantics"
```
