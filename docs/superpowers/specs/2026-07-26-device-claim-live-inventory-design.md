# Device Claim Live Inventory Design

## Context

로그인한 사용자가 목록에서 `이 기기에만 저장` 로그를 모두 삭제해도 Settings의 `기기 데이터 가져오기`가 다시 `15`로 바뀌고, claim sheet가 오래 열린 채 하단 탭 입력을 막는다. 사용자가 `기기에 유지`를 눌러도 sheet가 즉시 닫히지 않는 경우가 있다.

코드 추적 결과 같은 숫자처럼 보이는 값이 두 저장소에서 온다.

- `eligibleGuestCounts`는 현재 guest Logbook/Planbook row를 센다.
- `GuestClaimStore`는 user principal별 immutable claim snapshot과 retained/failure 결과를 `dive-app:data:user:<user-id>:claim:v1`에 보존한다.

Guest row를 삭제하면 React Query 목록만 갱신된다. Claim presentation은 다시 계산되지 않고, `prepared`, `deferred`, 일부 `failed` snapshot은 retry에서 현재 guest inventory와 대조하지 않은 채 재사용된다. 따라서 실제 guest row가 `0`이어도 Settings가 snapshot의 `15`를 표시하거나, retry가 삭제 전 snapshot을 다시 처리할 수 있다.

Sheet는 native `formSheet`이므로 열려 있는 동안 하단 탭을 터치할 수 없다. 여기에 `usePreventRemove`와 action-wide `busyAction`이 겹쳐 검사나 retry가 끝날 때까지 sheet를 닫거나 `기기에 유지`를 누르지 못한다.

## Product Decisions

- 실제 guest Logbook/Planbook inventory만 `기기 데이터` 개수의 기준으로 사용한다.
- Claim snapshot은 원격 claim의 재시작 체크포인트이지 현재 기기 데이터 목록이 아니다.
- 현재 guest inventory가 `0`이면 Settings의 `기기 데이터 가져오기` 행을 표시하지 않는다.
- guest row save/delete 뒤 claim inventory를 즉시 다시 계산한다.
- claim sheet를 열 때도 현재 inventory를 다시 검사한다.
- 현재 inventory와 맞지 않는 local-only snapshot은 retry에서 재사용하지 않는다.
- remote batch가 시작된 snapshot은 idempotent remote 복구를 위해 보존한다. 이 상태의 진행 정보는 현재 기기 데이터 개수로 표시하지 않는다.
- claim sheet는 검사·업로드 중에도 닫을 수 있다. Sheet가 claim 작업의 생명주기를 소유하지 않는다.
- `기기에 유지`는 사용자 입력 직후 sheet를 닫고, defer persistence는 provider에서 계속 처리한다.
- 앱이 foreground에 있는 동안 닫힌 claim sheet의 작업은 계속된다. 앱 종료 뒤에는 기존 persistent checkpoint 규칙으로 재개한다.
- Supabase schema, RLS, Edge Function과 demo/real capture 처리에는 변경이 없다.

## Explored Approaches

### A. Zero-count snapshot purge

현재 guest count가 `0`이면 snapshot을 무조건 지우고 Settings 행을 숨긴다. 구현은 작지만 이미 remote staging이 시작된 snapshot까지 잃을 수 있어 idempotent recovery와 account publication을 손상할 수 있다.

### B. Live inventory와 transaction checkpoint 분리

Settings와 자동 sheet 표시는 live guest inventory만 사용한다. Local-only snapshot은 현재 inventory와 대조해 stale이면 교체하고, remote progress가 있는 snapshot은 transaction recovery 용도로 보존한다. Sheet는 작업과 분리해 언제든 닫을 수 있다. **채택한다.**

### C. Persistent background import manager

별도 job queue와 scheduler가 검사, upload, retry, cancel, notification을 소유한다. 장시간·다중 작업에는 적합하지만 현재 결함을 고치는 범위를 넘어 새 상태 시스템과 remote cancellation 정책이 필요하다.

## State Model

### Live Guest Inventory

```ts
type GuestInventoryCounts = {
  logCount: number;
  planCount: number;
};
```

`GuestInventoryCounts`는 `guestRepositories.logbook.list()`와 `guestRepositories.planbook.list()`를 직접 읽은 결과다. Hidden claim ID는 remote commit 뒤 cleanup 중 account copy와 중복 표시되는 row만 제외한다.

Settings의 숫자, Settings 행 표시 여부, 로그인 직후 자동 claim sheet 조건은 이 count만 사용한다.

### Claim Checkpoint

`GuestClaimSnapshot`은 다음 책임만 갖는다.

- user-scoped immutable upload payload
- remote batch ID와 item별 stage progress
- remote finalize/account publication/local cleanup 재개
- profile verification에서 retained 된 항목의 진단 정보

Snapshot의 `manifest.items.length`, `retainedItems.length`, `failed.total`은 현재 guest inventory count로 사용하지 않는다.

### Snapshot Freshness

Retry 또는 defer 전에 snapshot을 다음처럼 분류한다.

1. `prepared`, `deferred`, `retained`, `committed` 또는 `remoteBatchId`가 없는 `failed`
   - 현재 guest inventory와 snapshot source set을 대조한다.
   - row가 삭제·추가·변경되어 다르면 기존 local-only snapshot을 제거하고 현재 inventory로 새 snapshot을 만든다.
   - 현재 inventory가 비어 있으면 snapshot을 제거하고 `undefined`를 반환한다.
2. `remoteBatchId`가 있거나 `running`, `finalizing`, `cleanupPending`인 snapshot
   - 원격 idempotency와 cleanup을 위해 기존 checkpoint를 보존한다.
   - 이 checkpoint는 live inventory count를 부풀리지 않는다.
3. `committed`/`retained` terminal snapshot
   - 기존 exact retained comparison을 유지하되, live inventory가 비어 있으면 terminal result를 Settings action으로 노출하지 않는다.

Freshness 비교는 entity kind, `localId`, canonical local record digest를 사용한다. Claimable watch profile은 기존 strict profile 검증을 재사용한다. Settings count를 읽는 경로에서는 profile hashing을 수행하지 않는다.

## Mutation and Refresh Flow

1. 로그인 중 composed repository가 guest-owned row를 save/delete한다.
2. 로컬 mutation commit이 성공한 뒤 guest inventory revision을 증가시킨다.
3. `AccountDataProvider`가 revision을 관찰하고 `eligibleGuestCounts`를 다시 읽는다.
4. 새 count가 `0`이면 claim presentation을 `hidden`으로 바꾸고 자동 sheet routing을 중단한다.
5. Settings가 표시 중이면 row가 즉시 사라진다.
6. Account claim sheet가 열려 있다면 최신 refresh가 `hidden + 0`을 확인한 뒤 sheet를 닫는다.

Claim service가 exact cleanup으로 guest row를 삭제하는 경우에도 같은 refresh 결과를 publication completion에서 반영한다. React Query invalidation과 claim inventory refresh는 별도 책임으로 유지한다.

## Sheet Interaction

- Sheet mount/focus에서 `claim.refresh()`를 한 번 실행한다.
- refresh 중에는 stale count를 action 가능한 선택 화면으로 사용하지 않는다.
- refresh 결과가 `hidden`이고 live count가 `0`이면 `navigation.goBack()`한다.
- `usePreventRemove`로 sheet dismissal을 막지 않는다.
- start/retry/recheck는 중복 실행 버튼만 비활성화한다. Native grabber와 navigation back은 계속 동작한다.
- `기기에 유지`는 먼저 `navigation.goBack()`을 실행하고 defer를 요청한다.
- 사용자가 sheet를 닫아도 provider가 소유한 Promise, persisted progress, AppState resume은 유지된다.
- 하단 탭은 sheet가 닫힌 즉시 다시 터치할 수 있다.

## Settings Presentation

- authenticated/authenticatedOffline 상태이고 live guest count가 `1` 이상일 때만 `기기 데이터 가져오기` 행을 표시한다.
- 값은 `logCount + planCount`만 표시한다.
- retained item 수나 failed snapshot total을 기기 데이터 개수로 대신 표시하지 않는다.
- live guest count가 `0`이면 stale deferred/retained/failed snapshot이 남아 있어도 행을 숨긴다.
- 실제 remote recovery 상태를 장기적으로 노출할 별도 account-sync UI는 이 변경의 범위가 아니다.

## Error Handling

- Guest inventory read 실패: 마지막 snapshot total을 fallback으로 표시하지 않는다. Settings 행을 숨기고 기존 account-data degraded recovery를 사용한다.
- Local-only stale snapshot remove 실패: retry를 시작하지 않고 `claim_validation_failed`로 남긴다. 삭제된 snapshot payload를 업로드하지 않는다.
- Remote-progress snapshot: 기존 idempotent resume/finalize/cleanup을 유지한다.
- Offline: Settings에 live guest row가 있으면 행을 표시할 수 있지만 remote start는 기존처럼 비활성화한다.
- Session/user generation 변경: 기존 generation guard를 유지해 이전 user refresh가 새 principal에 publish되지 않게 한다.

## Testing

### Claim Service

- deferred snapshot 15개를 만든 뒤 guest rows를 모두 삭제하면 retry가 snapshot을 업로드하지 않고 store를 제거한다.
- local-only failed/prepared snapshot과 현재 inventory가 다르면 fresh snapshot으로 교체한다.
- remote batch ID가 있는 failed snapshot은 기존 idempotent checkpoint를 보존한다.
- unchanged deferred snapshot은 같은 batch identity와 immutable source를 재사용한다.

### Account Data State

- 로그인 상태에서 device-only row를 삭제하면 eligible count가 `1 → 0`으로 갱신된다.
- stale terminal/deferred snapshot이 있어도 live inventory `0`이면 claim presentation은 hidden이다.
- 이전 user generation의 늦은 inventory refresh는 무시한다.

### Settings

- live count `0`이면 retained/deferred/failed snapshot과 관계없이 import row를 숨긴다.
- live count가 있으면 snapshot total이 아니라 live count를 표시한다.

### Claim Sheet

- mount에서 모든 claim state를 refresh한다.
- hidden + zero 결과로 갱신되면 sheet를 닫는다.
- running/preparing 중에도 navigation removal을 막지 않는다.
- `기기에 유지`는 persistence가 pending이어도 즉시 sheet를 닫는다.
- start/retry 중 sheet를 닫아도 작업 Promise는 취소하지 않는다.

### Gates

1. focused Jest suites for guest claim service, account data state, Settings, claim sheet, navigation
2. `yarn mobile:typecheck`
3. full mobile Jest suite
4. `yarn ios:build`
5. wiki update and `yarn codex:check`
6. physical iPhone: all device-only rows delete → Settings row disappears; relaunch; no stale 15; new guest row → count 1; import; sheet dismissal and tab switching

## Wiki Update

구현 검증 뒤 현재 code와 이 설계를 raw source로 보존하고 `.wiki/wiki/architecture/sync-flow.md`에 다음 지식을 반영한다.

- live guest inventory와 claim checkpoint의 책임 분리
- snapshot count를 Settings device-data count로 사용하지 않는 규칙
- local-only stale snapshot freshness 검사
- claim sheet가 transaction lifecycle을 소유하지 않는 경계

## Non-Goals

- Supabase migration, RLS, Storage policy, Edge Function 변경
- background fetch, push notification, OS-terminated 상태에서의 연속 실행
- remote uncommitted batch cancellation API
- account sync status 전용 화면
- WatchConnectivity payload, demo session, profile digest 의미 변경
- guest/account 목록 section 분리
- 감압, 상승, 비상 판단 등 safety-critical 기능

## Self-Review

- 현재 guest inventory와 persisted claim snapshot을 같은 count로 사용하지 않는다.
- 삭제한 local-only snapshot payload가 retry로 되살아나는 경로를 차단한다.
- remote progress가 있는 checkpoint는 강제 삭제하지 않아 기존 idempotency를 보존한다.
- 데이터가 없을 때 Settings action을 숨긴다는 사용자 요구와 modal/touch 회복 요구를 명시했다.
- C의 job manager, remote cancellation, OS background 실행은 포함하지 않는다.
