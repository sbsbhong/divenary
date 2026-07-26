# Home and Device Inventory Performance Design

## Context

Home 진입과 탭 복귀가 느리고, 실제 guest Logbook/Planbook row를 모두 삭제한 뒤에도
기기 데이터 관련 sheet 또는 recovery action이 남아 하단 탭 입력을 막는 문제가 있다.
UI 구조와 시각 디자인은 유지하고 데이터 준비 경로만 수정한다.

코드 추적에서 서로 독립적인 두 병목을 확인했다.

- Home conditions는 위치, Weather, Marine, reverse geocode를 직렬로 기다리고,
  Home remount와 foreground 복귀마다 같은 전체 요청을 반복한다.
- Account claim refresh는 live inventory보다 persisted claim snapshot을 먼저 읽은 뒤,
  snapshot item마다 같은 repository envelope를 다시 읽고 profile을 다시 해시한다.
  여러 refresh가 겹칠 때 이전 결과가 최신 `0 + hidden` 결과를 덮을 수도 있다.

Native `formSheet`가 열린 동안 아래 tab을 막는 것은 iOS의 정상 동작이다. 따라서
실제 기기 데이터가 없을 때 sheet를 열지 않고, 열린 sheet의 검사가 짧고 닫을 수
있도록 만드는 것이 논리 수정의 목표다.

## Product Decisions

- Home conditions의 마지막 정상 결과는 locale별로 5분간 재사용한다.
- 같은 locale의 진행 중 conditions 요청은 공유한다.
- Weather, Marine, reverse geocode는 위치 확정 뒤 동시에 시작한다.
- Marine과 reverse geocode는 선택 정보이며 제한 시간 안에 끝나지 않아도 air
  temperature 결과를 막지 않는다.
- Weather와 Marine fetch는 제한 시간에 실제 요청도 abort한다.
- 수동 재시도는 cache를 무시하지만 기존 ready snapshot은 요청 중 유지한다.
- 현재 guest Logbook/Planbook inventory가 `0`이면 전체 claim snapshot이나
  profile을 동기 경로에서 읽지 않고 즉시 `hidden + 0`을 publish한다.
- 전체 snapshot과 분리된 작은 advisory checkpoint hint로 실제 복구 중인
  transaction만 찾는다. Hint는 개수나 transaction 진실의 근거가 아니며 resume
  전에 전체 snapshot을 다시 검증한다.
- Hint가 없는 legacy snapshot은 UI interaction 뒤 publication당 한 번만 deferred
  audit하고, 복구 가능 상태만 background resume한다. Snapshot 부재나 read/backfill
  실패로 hint가 계속 unknown이어도 같은 publication에서 전체 read를 반복하지 않는다.
- Claim snapshot은 현재 기기 데이터 개수가 아니라 transaction checkpoint다.
- 같은 publication에서 겹친 inventory 검사 중 가장 최근 요청만 hidden IDs와
  presentation을 publish할 수 있다.
- Snapshot reconciliation은 guest repository를 entity마다 다시 읽지 않고 한 번
  읽은 inventory를 재사용한다.
- Remote publication 전 snapshot은 모든 source를 guest 우선으로 표시하면 되므로
  record/profile digest 비교를 수행하지 않는다.
- Home recovery, Settings action, 자동 claim sheet는 live eligible count가 1 이상일
  때만 노출한다.
- Sheet mount refresh가 끝나기 전에는 이전 choice action을 실행할 수 없고, close는
  계속 가능하다.

## Conditions Flow

1. Hook mount에서 locale별 fresh cache를 동기적으로 확인한다.
2. Fresh cache가 있으면 즉시 ready snapshot을 표시하고 네트워크 요청을 생략한다.
3. Cache가 없으면 foreground location을 가져온다.
4. 좌표가 준비되면 Weather, Marine, reverse geocode를 동시에 시작한다.
5. Weather는 필수이며 bounded request timeout을 사용한다.
6. Marine과 reverse geocode는 더 짧은 enrichment timeout 뒤 fallback한다.
7. Ready 결과만 cache하고 permission/error 결과는 cache하지 않는다.
8. Foreground 복귀는 fresh cache를 존중한다. 수동 retry만 강제 refresh한다.

## Device Inventory Flow

1. Refresh마다 monotonic request ID를 발급한다.
2. Guest Logbook/Planbook을 한 번씩 병렬로 읽는다.
3. Raw inventory가 비어 있으면 hidden ID sets를 비우고 `hidden + 0`을 즉시 publish한다.
   과거 snapshot의 `15`는 UI count로 사용하지 않는다.
4. Online active 상태의 자동 복구 검사만 작은 checkpoint hint를 읽는다. `running`,
   `finalizing`, `cleanupPending`, `failed + network_unavailable` hint는 전체 snapshot을
   다시 검증하는 background resume를 시작하고, `inactive`는 즉시 종료한다.
5. Hint가 `unknown`인 legacy 상태는 after-interactions task에서 전체 snapshot을 한 번
   읽어 hint를 backfill한다. Task는 principal 전환이나 새 nonzero inventory가
   관찰되면 취소·무효화하며 presentation을 직접 변경하지 않는다. Audit/recovery
   token은 generation-scoped라 service generation 교체 시 이전 in-flight token을
   새 publication에 복사하지 않는다.
6. Inventory가 있을 때만 foreground claim snapshot을 읽는다.
7. Remote publication 전 checkpoint는 snapshot item 중 현재 존재하는 ID를
   guest-priority set에 넣는다. Profile bytes는 읽지 않는다.
8. `committed` 또는 `cleanupPending` checkpoint만 immutable record/profile exact
   comparison을 수행한다. 이때도 이미 읽은 rows를 map으로 재사용한다.
9. Hidden sets를 적용한 뒤 같은 rows에서 eligible count를 계산한다.
10. 모든 await 경계 뒤 request ID와 principal generation을 확인한다. 이전 refresh는
   어떤 mutable set이나 React state도 변경하지 않는다.

## Action Visibility

- Settings import row: authenticated이며 live eligible count가 1 이상일 때만 표시한다.
- Automatic sheet: `choice + eligible > 0`에서만 표시한다.
- Home recovery card: `failed/deferred + eligible > 0`에서만 표시한다.
- Open sheet refresh가 `hidden + 0`을 반환하면 즉시 닫는다.
- Refresh pending 중에는 stale import/keep action을 숨기고 close action만 유지한다.

Home의 전체 기록 수는 account와 visible guest를 합친 로그 수다. Account 로그 15개와
guest 로그 0개이면 Home은 15개를 표시할 수 있지만, 기기 데이터 action은 없어야 한다.

## Error and Recovery Boundaries

- Guest inventory read 실패 시 snapshot total로 fallback하지 않고 `hidden + 0`을
  유지한다.
- Remote-progress checkpoint는 삭제하지 않는다. Live inventory가 있을 때 기존
  resume/finalize/cleanup 의미를 유지한다.
- Zero-inventory fast path는 checkpoint를 제거하지 않으므로 transaction evidence를
  손실시키지 않는다. Stale recoverable hint에 full snapshot이 없을 때만 hint를
  best-effort로 정리한다.
- Hint write/remove는 authoritative snapshot 뒤의 advisory 작업이므로 실패해도
  claim 자체를 실패시키지 않는다. Recoverable 전환 전 stale inactive hint 제거만
  false-negative 방지를 위해 full snapshot write보다 먼저 성공해야 한다.
- Store 작업은 user claim key별로 직렬화해 오래된 read backfill이 최신 recoverable
  hint를 덮지 못하게 한다.
- Weather failure는 conditions error다. Marine/geocoder failure 또는 timeout은
  water/city enrichment만 생략한다.
- Supabase schema, RLS, Edge Function, WatchConnectivity payload와 UI layout은
  변경하지 않는다.

## Verification

- Home conditions controller: fresh remount cache, foreground cache, concurrent request sharing.
- Open-Meteo provider: three operations start concurrently; optional stalled work is bounded.
- Account data: zero inventory does not read snapshot; out-of-order refresh cannot restore stale
  count; N-item reconciliation does not perform N repository `get` calls/profile reads before
  publication; active hint cold-start recovery and legacy deferred audit remain UI-silent.
- Navigation/Home: zero eligible rows suppress recovery and auto-route.
- Claim sheet: pending mount refresh hides stale actions while close remains available.
- Focused Jest, mobile typecheck, full mobile Jest, iOS build.
