# Guest Claim Profile Quarantine Design

## Context

실기기에서 `기기 데이터 가져오기`를 실행하면 `0 / 14`에서 즉시 실패하고, `위치 다이브 항목을 확인하지 못했습니다`가 반복된다. 조사 결과 staging의 account-data/RLS/guest-claim verifier는 통과했고 해당 시도에는 원격 batch가 생성되지 않았다. 실패는 원격 업로드 전 `createGuestClaimSnapshot()`이 watch profile을 읽고 digest, sample count, session identity를 검사하는 local preflight에서 발생한다.

현재 구현은 한 log의 profile이 없거나 손상되면 snapshot 생성을 throw하여 정상인 나머지 13개도 전혀 가져오지 않는다. 재시도는 같은 불변 조건을 다시 검사하므로 항상 같은 결과가 나온다. native profile read 오류도 JavaScript adapter에서 `undefined`로 합쳐지므로 UI는 원본 없음과 읽기/형식 손상을 구분하지 못한다.

이번 변경은 사용자가 선택한 접근 A를 구현한다. 검증 가능한 항목은 계정으로 가져오고, profile을 안전하게 증명할 수 없는 항목과 그 관계 묶음은 guest 원본 그대로 보류한다.

## Product Decisions

- profile이 없거나 손상된 log 하나 때문에 관계없는 정상 항목의 claim을 막지 않는다.
- 보류된 record와 profile artifact는 수정, 축약, 재작성, 삭제하지 않는다.
- profile을 제외한 preview payload만 계정에 올려 성공으로 취급하지 않는다.
- 정상 항목만 immutable snapshot과 remote batch에 포함한다. remote expected counts와 진행률은 실제 전송 항목 수를 기준으로 한다.
- 완료 화면은 `가져온 항목`과 `기기에 유지한 항목`을 별도로 표시한다. 예: `13개 가져옴 · 1개 기기에 유지`.
- 자동 재시작은 같은 보류 항목을 반복 검사하거나 sheet를 다시 띄우지 않는다. Settings에서 사용자가 `다시 검사`를 선택했을 때만 보류 항목을 명시적으로 재평가한다.
- guest record나 profile reference가 바뀌면 이전 보류 판정은 더 이상 현재 원본과 일치하지 않으므로 새 검사 대상으로 취급한다.
- manifest 구조, 관계, principal ownership을 신뢰할 수 없는 오류는 부분 claim으로 완화하지 않는다. 원격 write 없이 기존 hard failure를 유지한다.
- Supabase schema, RLS, Edge Function과 watchOS contract는 변경하지 않는다.

## Explored Approaches

### A. Non-destructive partial claim with retained items

전체 local preflight를 수행해 정상 항목만 claim하고 profile integrity를 증명하지 못한 항목은 guest에 남긴다. 사용자는 정상 데이터를 즉시 계정으로 가져오며, 문제 항목은 별도 복구 상태로 확인한다. 데이터 보존과 실제 사용성의 균형이 가장 좋아 채택한다.

### B. Preview-only repair

손상된 profile reference를 제거하고 log preview만 계정 record로 생성한다. 한 번에 모두 가져오는 장점은 있지만 원본 record 의미를 바꾸고 full profile이 없는 account copy를 정상 완료로 오인하게 하므로 제외한다.

### C. Strict batch blocking with clearer copy

오류 원인과 항목만 자세히 보여주고 전체 claim은 계속 차단한다. 변경 범위는 작지만 정상 데이터까지 영구적으로 막고 결정적 오류에 대한 재시도 loop를 해소하지 못해 제외한다.

## Eligibility and Quarantine Model

### Preflight result

Snapshot preparation은 throw-only API 대신 다음 두 집합을 반환한다.

```ts
type GuestClaimRetainedReason =
  | 'profile_missing'
  | 'profile_corrupt'
  | 'related_item_retained';

type GuestClaimRetainedItem = {
  entityKind: 'plan' | 'log';
  clientRecordId: string;
  localRecordSha256: string;
  label?: string;
  reason: GuestClaimRetainedReason;
  relatedClientRecordId?: string;
};

type GuestClaimSnapshot = {
  // existing fields remain
  retainedItems: GuestClaimRetainedItem[];
};
```

- `items`와 `snapshots`에는 검증을 통과해 실제 claim할 record만 들어간다.
- `retainedItems`에는 raw payload나 profile bytes를 넣지 않는다. record identity, exact local digest, 사용자용 label, 안정적인 reason만 보존한다.
- 기존 persisted snapshot은 `retainedItems: []`로 읽어 backward compatibility를 유지한다. remote manifest digest에는 retained metadata를 포함하지 않는다.
- profile이 없는 경우 `profile_missing`, bytes parse/digest/sample/session 검증이 실패한 경우 `profile_corrupt`로 분류한다.
- storage adapter가 `undefined`로 반환한 항목은 현재 API 경계에 맞춰 `profile_missing`으로 보류한다. 이 값은 내부 분류일 뿐 사용자에게 실제 파일 부재로 단정하는 문구를 노출하지 않는다. parse 이후 digest/sample/session 검증 실패는 `profile_corrupt`로 구분한다.

### Relationship closure

관계를 절반만 claim하지 않는다.

- 보류 log를 가리키는 plan은 `related_item_retained`로 함께 보류한다.
- 보류 plan을 source로 참조하는 log도 같은 관계 묶음에 포함한다.
- 관계 묶음은 고정점에 도달할 때까지 계산한다.
- 존재하지 않는 target, duplicate local id, 모순된 양방향 관계처럼 관계 graph 자체를 신뢰할 수 없는 경우는 기존 `relationship_invalid` hard failure로 남긴다.

이 규칙으로 account에는 converted plan/log 관계가 완전한 항목만 공개된다.

## State and Persistence

### Snapshot states

기존 remote lifecycle status는 그대로 유지한다. 여기에 전송 가능한 항목이 하나도 없고 보류 항목만 있는 local terminal state `retained`를 추가한다.

- valid > 0, retained = 0: 기존 claim과 동일하다.
- valid > 0, retained > 0: valid items를 claim하고 cleanup한 뒤 `committed`에 retained summary를 함께 보존한다.
- valid = 0, retained > 0: remote repository를 호출하지 않고 `retained`로 저장한다.
- valid = 0, retained = 0: claim sheet를 열지 않는다.

`committed` 또는 `retained` snapshot에 기록된 retained item이 현재 guest record의 id와 `localRecordSha256`에 정확히 일치하면 로그인/foreground lifecycle에서 자동으로 다시 claim하지 않는다. 명시적인 `recheckRetained()`는 terminal snapshot을 제거하고 현재 guest 원본으로 새 preflight를 수행한다.

새 guest record가 추가되거나 기존 retained record bytes가 변경되면 Settings count에는 새 검사 대상이 반영된다. 자동 sheet는 새 eligible record가 있을 때만 열고, unchanged retained-only 상태는 앱 시작을 방해하지 않는다.

### Exact cleanup

Cleanup은 기존과 같이 manifest의 claim item만 대상으로 한다.

- remote committed readback과 account local publication/readback이 끝난 항목만 exact-match guest cleanup을 수행한다.
- `retainedItems`는 cleanup loop와 changed-row promotion 대상에 넣지 않는다.
- claim 중 수정된 정상 source row는 기존 reconciliation 규칙을 유지한다.
- 부분 완료 후에도 retained row와 profile artifact는 guest partition에서 계속 조회 가능하다.

## User Experience

### Checking

`계정으로 가져오기`를 누르면 remote write 전에 local preflight를 완료한다. 검사 중에는 `기기 데이터를 확인하는 중`을 표시하며 transfer progress와 섞지 않는다.

### Transfer

전송 진행률의 denominator는 valid item 수다. 14개 중 1개가 보류되면 upload 단계는 `0 / 13`부터 시작한다. 보류 항목을 completed로 세어 `14 / 14`처럼 표시하지 않는다.

### Partial completion

정상 claim이 끝나면 sheet는 실패 화면으로 남지 않고 결과 화면으로 전환한다.

- Title: `기기 데이터를 가져왔습니다`
- Summary: `13개를 계정으로 가져왔습니다.`
- Retained notice: `확인할 수 없는 1개는 이 기기에 그대로 두었습니다.`
- Primary action: `완료`
- Secondary action when retained exists: `보류 항목 보기`

보류 상세에는 record label, 종류, 안전한 원인 copy를 표시한다.

- `profile_missing`: `기록에 연결된 상세 수심 데이터를 확인하지 못했습니다.`
- `profile_corrupt`: `상세 수심 데이터를 안전하게 확인하지 못했습니다.`
- `related_item_retained`: `연결된 기록과 함께 기기에 유지했습니다.`

raw storage key, absolute path, payload, digest, native exception은 표시하지 않는다.

### Retained-only result

전송 가능한 항목이 하나도 없으면 generic 실패나 `0 / N` retry 화면을 보여주지 않는다.

- Title: `일부 데이터를 확인해야 합니다`
- Body: `확인할 수 없는 항목은 이 기기에 그대로 보존되어 있습니다.`
- Primary action: `완료`
- Secondary action: `다시 검사`

`다시 검사`는 사용자가 profile을 복구했거나 원본 상태가 달라졌다고 판단할 때만 실행한다. 같은 결과가 나오면 terminal retained state로 돌아가며 remote call은 여전히 0회다.

### Settings

Settings row는 서로 다른 수치를 구분한다.

- 새로 가져올 수 있는 guest data: 기존 count
- 이전 검사에서 보류된 data: `확인 필요 N`
- 실행 중/실패 manifest: 기존 recovery state

row를 누르면 언제나 같은 claim sheet route가 열리며 무반응으로 끝나지 않는다. retained-only 상태는 로그인 직후 자동으로 sheet를 띄우지 않는다.

## Error Semantics

- `profile_missing`과 `profile_corrupt`는 snapshot 전체 failure가 아니라 item-level retained reason으로 사용한다.
- `network_unavailable`, `session_expired`, `remote_conflict`는 valid subset claim의 기존 batch-level error로 유지한다.
- `relationship_invalid`, malformed persisted snapshot, principal mismatch, storage write failure는 전체 hard failure로 유지한다.
- hard failure는 원격 호출 전이면 원격 batch를 만들지 않고, 원격 호출 후면 기존 idempotent resume 규칙을 따른다.
- 오류 copy는 retry 가능 여부를 반영한다. 결정적인 retained 상태에는 generic `다시 시도`를 primary action으로 두지 않는다.

## Accessibility and Theme

- partial completion과 retained-only 상태를 color만으로 구분하지 않고 title, count, reason을 함께 제공한다.
- count는 tabular figures를 유지한다.
- Dynamic Type에서 결과 summary와 항목 label은 줄바꿈을 허용한다.
- VoiceOver completion announcement는 `13개 가져옴, 1개 기기에 유지`처럼 두 결과를 모두 말한다.
- sheet root, footer, bottom safe area는 현재 resolved light/dark appearance를 그대로 사용한다.
- 새로운 illustration, gradient, dependency는 추가하지 않는다. 기존 depth-trace progress와 Apple식 form sheet hierarchy를 유지한다.

## Testing Strategy

### Snapshot and service

- 14개 중 한 watch profile이 missing이면 valid 13개만 manifest에 들어가고 missing log는 retained에 남는다.
- corrupt bytes, digest mismatch, sample-count mismatch, session mismatch를 `profile_corrupt`로 보류한다.
- retained log와 연결된 plan/log 관계 묶음을 함께 보류한다.
- 관계 graph 자체가 invalid면 부분 claim하지 않고 remote call 0회의 hard failure가 된다.
- valid 13개가 committed/cleaned up된 뒤 retained source와 profile reference는 guest에 남는다.
- all-retained snapshot은 remote create/stage/finalize를 한 번도 호출하지 않는다.
- unchanged retained snapshot은 cold launch/foreground에서 자동 재검사하지 않는다.
- explicit recheck 뒤 profile이 복구되면 새 snapshot에 포함되어 정상 claim된다.
- 기존 retained field가 없는 snapshot은 빈 retained list로 읽힌다.

### State and UI

- partial completion은 imported/retained counts와 보류 상세 진입을 표시한다.
- retained-only 결과는 `0 / N` 실패 화면 대신 보존 안내를 표시한다.
- deterministic retained 상태의 primary action은 `완료`, explicit secondary action만 `다시 검사`다.
- Settings row는 claimable count와 retained count를 구분하고 같은 sheet를 연다.
- retained-only 상태는 로그인 직후 자동 제안되지 않는다.
- light/dark에서 content와 bottom safe area가 같은 semantic surface를 사용한다.

### Verification gates

1. focused claim store/service/state/screen Jest tests
2. full mobile Jest suite
3. `yarn mobile:typecheck`
4. `yarn ios:build`
5. staging guest-claim verifier로 remote regression 확인
6. physical iPhone에서 기존 14개 dataset으로 `13개 가져옴 · 1개 기기에 유지`, force quit/relaunch, explicit recheck 확인

앱 삭제, AsyncStorage 초기화, guest 원본 수정이 있어야 성공하는 검증은 통과로 인정하지 않는다.

## Non-Goals

- 손상 profile 자동 생성 또는 raw record rewrite
- profile이 없는 account log를 정상 완료로 만드는 preview-only import
- guest 원본 자동 삭제
- Supabase schema/RLS/Edge Function 변경
- watchOS target 또는 WatchConnectivity acknowledgement 의미 변경
- production Supabase 승격, account deletion
- 감압, 상승, 비상 판단 등 safety-critical 기능

## Self-Review

- 데이터 보존: retained item은 remote manifest와 cleanup에서 제외하고 guest 원본을 변경하지 않는다.
- 관계 보존: 한쪽만 claim하지 않고 관계 묶음 전체를 보류하며 graph corruption은 hard failure로 남긴다.
- 재발 방지: deterministic retained 상태를 terminal로 저장하고 자동 retry loop를 만들지 않는다.
- 진행률 정합성: 검사 대상 수, 실제 전송 수, 보류 수를 서로 섞지 않는다.
- 호환성: 기존 snapshot은 retained empty로 읽고 remote contract와 Supabase schema를 바꾸지 않는다.
- 범위: mobile guest claim preparation, persistence, state, Settings/sheet UI에 한정한다.
