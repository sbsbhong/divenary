Source URL: apps/mobile/src/sync/account-payload.ts; packages/supabase/src/account-data-mappers.ts; local simulator account storage and Supabase HTTP cache
Collected: 2026-07-26
Published: 2026-07-26

# Account float roundtrip recovery evidence

## Reported behavior

- 같은 account의 simulator에서 만든 log 4개와 iPhone에서 만든 log 1개 중
  simulator에는 4개만 보였다.
- Device data import는 완료됐지만 Home에는
  `일부 데이터를 확인하지 못했습니다` recovery 안내가 계속 보였다.

## Runtime evidence

Booted iPhone simulator의 account partition과 Supabase HTTP response cache를 읽기
전용으로 비교했다.

- account local Logbook에는 synced manual log 4개가 있었다.
- guest Logbook은 비어 있었고 account outbox도 비어 있었다.
- Supabase `dive_logs` list response에는 같은 owner의 non-deleted row 5개가 모두 있었다.
- 누락된 다섯 번째 row는 source가 `watch`이며 canonical profile path, profile
  descriptor와 embedded Watch metadata를 모두 가지고 있었다.
- 현재 remote parser로 각 row를 검사하면 manual row 4개는 통과하고 Watch row만
  `Malformed remote log payload digest`로 실패했다.

따라서 pagination, RLS, owner filtering, guest claim, local device inventory 또는
서버 row 누락이 원인이 아니다. 정상 row 4개를 먼저 local에 반영한 뒤 한 row의
실패를 aggregate하는 partial hydration 경로가 사용자가 본 4/5 결과와 Home recovery
안내를 함께 만들었다.

## Numeric evidence

누락된 row의 원래 account payload와 DB-mapped payload를 canonical hash 기준으로
재구성했다.

- stored payload digest:
  `ca0c730f…`
- original `max_depth_meters`:
  `11.600000000000001`
- PostgreSQL/PostgREST readback `max_depth_meters`:
  `11.6`
- 두 JavaScript number는 같지 않으며 binary64 bit pattern은 각각
  `0x4027333333333334`, `0x4027333333333333`이다.
- Embedded `watch_metadata.measuredValues.maxDepthMeters`는 원래 긴 값을 보존했다.
- DB-mapped top-level value를 embedded source 값으로만 복원하면 canonical payload
  hash가 stored digest와 정확히 일치했다.

다른 JSON object에서 관찰된 key order 차이는 canonical stringify가 key를 정렬하므로
digest 차이의 원인이 아니었다.

## Code boundary

- `createAccountRemoteLog`는 Watch measured value를 top-level typed summary와 embedded
  `watch_metadata.measuredValues`에 함께 넣고 전체 payload를 hash한다.
- `toDiveLogFields`는 top-level summary를 PostgreSQL `double precision` column에
  저장한다.
- `fromDiveLogRow`는 DB typed column과 JSON source duplicate를 합쳐 remote payload를
  재구성한다.
- Existing parser는 exact digest와 claim relation-null compatibility만 허용해
  인접한 floating representation을 가진 row도 malformed로 거부했다.
- Repository save readback도 typed floating column을 exact 비교해 server insert가
  완료된 새 Watch row를 local conflict로 오인할 수 있었다.

## Chosen correction

- DB typed floating summary인 `duration_seconds`, `max_depth_meters`에만
  exact binary64-neighbor comparison을 사용한다.
- PostgreSQL `integer`인 `rating`은 이 호환 처리에 포함하지 않는다.
- 일반 epsilon, decimal rounding 또는 percentage tolerance는 사용하지 않는다.
- Remote parser는 embedded source data와 DB typed value가 exact 또는 한 ULP
  인접한 경우에만 source value를 candidate에 복원한다.
- Source precedence는 account payload producer와 동일하게 Watch measured value를
  먼저 사용하고, 없으면 manual measured value를 사용한다.
- 복원 candidate 전체가 기존 stored SHA-256과 정확히 일치해야만 row를 수용한다.
- Claim relation UUID compatibility가 필요한 row는 같은 candidate에서 지정 relation
  하나만 null로 되돌린 기존 digest 규칙을 조합한다.
- 한 ULP보다 큰 차이, source 누락·변조, 다른 field 차이 또는 final digest mismatch는
  계속 fail-closed다.
- Profile, timestamp, owner, path, relation과 row isolation 경계는 변경하지 않는다.

## Home recovery meaning

Home의 generic recovery 안내는 device inventory count가 아니라 account bootstrap의
degraded 상태다. 이번 runtime에서는 remote row digest failure가
`remoteHydration/degraded`를 만들었다. 안내는 persistent storage에 저장되지 않으므로
재시작 뒤 다시 나타나는 것은 stale UI가 아니라 같은 pull failure의 반복이다.

Recovered row가 정상 hydrate되면 기존 successful cloud refresh 경로가 account query를
갱신하고 matching `remoteHydration` issue만 `ready`로 되돌린다. Device claim 안내와
상태는 독립적으로 유지한다.

## Verification boundary

Package test는 one-ULP save readback과 farther mismatch를 함께 검증해야 한다. Mobile
test는 실제 `11.600000000000001 → 11.6` Watch payload가 기존 digest로 hydrate되는지,
source mutation과 larger drift가 계속 거부되는지 확인해야 한다. Account state test는
성공한 follow-up hydration 뒤 missing row publication과 Home issue recovery를 확인해야
한다.

자동 test와 simulator build가 통과해도 실제 iPhone과 simulator 사이의 5/5 convergence는
사용자의 같은 account 환경에서 다시 확인해야 한다.
