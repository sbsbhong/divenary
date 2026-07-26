# Account Float Roundtrip Recovery Design

## Context

한 계정으로 simulator에서 만든 로그 4개와 iPhone에서 만든 Watch 로그 1개가
Supabase에는 모두 존재하지만, 다른 기기에서는 4개만 보이고 Home에는
`일부 데이터를 확인하지 못했습니다` 안내가 남는다.

실제 simulator의 account local repository, outbox, Supabase HTTP response를 읽기
전용으로 대조한 결과는 다음과 같다.

- Supabase의 owner-scoped `dive_logs` 응답에는 live row 5개가 모두 있다.
- account local repository에는 정상 manual row 4개만 있고 outbox는 비어 있다.
- 누락된 Watch row는 `parseAccountRemoteLog`에서
  `Malformed remote log payload digest`로 격리된다.
- 원래 Watch payload의 `max_depth_meters`는 `11.600000000000001`이고, 같은 값의
  PostgreSQL `double precision` readback은 `11.6`이다.
- 두 값은 IEEE-754 binary64에서 정확히 인접한 값이며, 나머지 payload content와
  profile descriptor는 동일하다.
- embedded `watch_metadata.measuredValues.maxDepthMeters`는 원래 값을 보존하며,
  그 값을 top-level summary에 복원하면 저장된 SHA-256과 정확히 일치한다.

따라서 RLS, account owner, pagination, guest/device claim 또는 local row count가
원인이 아니다. Home 안내는 별도의 stale device-import 오류가 아니라 이 row의
remote hydration 실패가 만든 `remoteHydration/degraded` 상태다.

## Product Decisions

- UI layout, copy, list badge, sheet, navigation은 변경하지 않는다.
- Supabase schema, migration, RLS, Edge Function도 변경하지 않는다.
- 저장된 SHA-256은 계속 최종 무결성 기준이다. Hash mismatch를 일반적으로
  허용하거나 새 digest로 덮어쓰지 않는다.
- DB typed floating summary field만 좁게 호환 처리한다.
  - `duration_seconds`
  - `max_depth_meters`
- 두 finite number가 exact match이거나 IEEE-754 binary64에서 정확히 한 ULP
  인접한 경우에만 같은 DB roundtrip value로 취급한다.
- Remote parser는 payload 안의 이미 hash된 source data에서만 원래 summary 값을
  재구성한다. 외부 추정값, 반올림 자릿수 또는 tolerance percentage를 사용하지 않는다.
- Source-derived candidate가 기존 stored SHA-256과 정확히 일치해야만 row를 수용한다.
- 한 ULP보다 큰 차이, source data 누락, schema 불일치, non-finite value 또는
  최종 digest mismatch는 계속 fail-closed다.
- 기존 claim relation compatibility와 조합될 수 있도록, relation-null fallback도
  같은 source-derived candidate에 제한적으로 적용한다.
- 성공한 pull 뒤 기존 `remoteHydration` issue를 지우는 account state 동작은
  유지하고 회귀 테스트로 고정한다. Device claim 상태를 이 안내와 섞지 않는다.

## Numeric Boundary

### Exact one-ULP comparison

공유 helper는 `left === right`를 먼저 확인한다. 서로 다른 finite number라면
binary64 bit pattern의 바로 위 또는 아래 인접값인지 확인한다.

- 일반 epsilon, decimal rounding, 상대 오차 범위는 사용하지 않는다.
- `NaN`, `Infinity`, 다른 type은 호환 대상으로 보지 않는다.
- `0`과 `-0`은 JavaScript numeric equality에 따라 같은 값이다.
- helper는 Hermes에서도 동작하도록 `DataView`와 32-bit word 연산을 사용하며
  `BigInt` runtime 지원에 의존하지 않는다.

### Repository save readback

`createAccountDataRepository`의 persisted-field 검증은 timestamp에 기존 canonical
instant comparison을 유지한다. 위 두 floating field에는 exact one-ULP comparison을
사용하고, 다른 scalar/JSON/path/hash/revision field는 기존 deep exact comparison을
유지한다.

이 경계는 새 Watch log가 server insert에는 성공했지만 DB readback 표현 차이 때문에
local conflict로 오인되는 문제도 함께 막는다.

### Remote payload recovery

Remote log parser는 schema와 timestamp normalization을 먼저 수행한 뒤 다음 순서로
digest candidate를 검사한다.

1. 현재 payload의 exact digest.
2. 유효한 claim relation UUID 하나만 `null`로 되돌린 기존 compatibility digest.
3. 아래 source precedence로 floating summary를 복원한 payload의 exact digest.
4. 복원 payload와 relation-null compatibility를 조합한 digest.

Source precedence는 `createAccountRemoteLog`와 같아야 한다.

- `duration_seconds`: `watch_metadata.measuredValues.durationSeconds` 우선,
  없으면 `manual_data.measuredValues.durationSeconds`
- `max_depth_meters`: `watch_metadata.measuredValues.maxDepthMeters` 우선,
  없으면 `manual_data.measuredValues.maxDepthMeters`
복원은 현재 typed field와 source field가 exact/one-ULP인 경우에만 수행한다. Candidate의
SHA-256이 stored digest와 exact match하면 parser가 source-derived summary를 포함한
payload를 반환한다. 이렇게 해야 다음 local model 생성과 재동기화도 원래 domain
값을 보존한다.

## Home Recovery State

Home의 generic 안내는 `AccountDataProvider.bootstrap.status === 'degraded'`를
표시한다. 현재 증상에서는 `issue.stage === 'remoteHydration'`이며 device inventory
경고와 별개다.

- 정상 row 4개는 먼저 저장되지만 Watch row 1개가 digest validation에 실패해
  hydration이 aggregate error를 던진다.
- parser가 해당 row를 정상 수용하면 5개가 모두 local account repository에 publish된다.
- 성공한 bootstrap/foreground/explicit cloud refresh는 matching
  `remoteHydration` issue만 `ready`로 바꾼다.
- 경고는 persistent storage에 저장되지 않으므로 앱 재시작 뒤 다시 보이는 것은
  stale UI가 아니라 같은 remote failure의 재현이다.

## Error and Compatibility Boundaries

- Payload 안의 중복 source data 자체가 변조되면 stored SHA-256을 맞출 수 없으므로
  거부된다.
- Top-level typed field만 변조되고 source data와 한 ULP보다 크게 다르면 거부된다.
- Profile download, byte count, sample count, profile SHA-256과 canonical path 검증은
  변경하지 않는다.
- Timestamp canonicalization, finalizer relation fallback, row isolation과 account
  owner validation도 변경하지 않는다.
- 정상적인 manual row와 plan payload에는 새 fallback이 개입하지 않는다.

## Verification

- Supabase package:
  - 인접한 `duration_seconds`, `max_depth_meters` readback은 saved다.
  - PostgreSQL `integer`인 `rating`은 one-ULP 호환 대상이 아니다.
  - 한 ULP보다 큰 차이는 conflict다.
  - shared numeric helper는 양수, 음수, zero, non-finite boundary를 검증한다.
- Mobile parser/coordinator:
  - 실제 shape의 Watch payload `11.600000000000001 → 11.6` row가 기존 digest로
    parse되고 hydrate된다.
  - source와 한 ULP보다 크게 다른 typed value는 digest failure로 남는다.
  - source data 또는 다른 field가 변조된 row도 거부된다.
  - relation fallback과 floating recovery의 조합은 exact original digest일 때만
    성공한다.
- Account state:
  - 해당 recovered remote row가 포함된 cloud pull은 5개를 publish하고
    `remoteHydration/degraded`를 `ready`로 되돌린다.
- Focused package tests, focused mobile Jest, mobile typecheck, full relevant mobile tests,
  iOS simulator build, `yarn codex:check`를 실행한다.
