Source URL: docs/superpowers/specs/2026-07-26-home-device-inventory-performance-design.md; apps/mobile/src/conditions/use-home-conditions.ts; apps/mobile/src/conditions/open-meteo-home-conditions-provider.ts; apps/mobile/src/states/account-data.tsx; apps/mobile/src/screens/account-claim/screen.tsx
Collected: 2026-07-26
Published: 2026-07-26

# Home conditions and device inventory performance hardening

실기기에서 Home의 위치·기온·수온 로딩과 로그인 뒤 기기 데이터 검사가 길어지는 동안 native claim sheet가 탭을 덮어 다른 화면의 터치를 막았다. 사용자가 실제 guest 로그와 계획을 모두 삭제한 뒤에도 과거 claim snapshot의 15개 항목이 남아 Settings와 sheet가 기기 데이터 action을 다시 노출했다.

Home 조건 로딩은 위치 확인 뒤 Weather, Marine, reverse geocode를 직렬 실행했고, Home 재마운트와 foreground 복귀마다 같은 요청을 다시 시작했다. Claim presentation refresh는 full snapshot을 먼저 읽고, snapshot item마다 guest repository `get`을 호출해 같은 local envelope를 반복 parse했다. 겹친 refresh에는 최신 결과를 보장하는 sequence guard가 없어 늦게 끝난 과거 nonzero 결과가 최신 zero 결과를 덮을 수 있었다.

수정된 경계는 다음과 같다.

- Home 조건의 `ready` 결과만 locale별로 5분 캐시하고 같은 locale의 in-flight 요청을 공유한다. permission denial, unavailable, error는 캐시하지 않는다.
- foreground 복귀는 fresh cache를 사용하고, 수동 retry는 현재 ready 화면을 유지한 채 강제 갱신한다. 강제 갱신과 foreground가 겹치면 같은 in-flight 결과를 공유한다.
- 위치 확인 뒤 Weather, Marine, reverse geocode를 동시에 시작한다. 필수 Weather는 8초 deadline, optional Marine과 reverse geocode는 각각 2.5초 deadline 뒤 안전한 fallback을 사용한다.
- Claim refresh는 live guest Logbook/Planbook inventory를 한 번 bulk read한 뒤 판단한다.
- Live inventory가 0이면 hidden/priority set을 비우고 presentation을 hidden 0으로 즉시 갱신하며 persistent claim snapshot을 읽거나 parse하지 않는다. Snapshot은 transaction recovery evidence로 그대로 보존한다.
- Live inventory가 존재할 때만 snapshot을 읽는다. Remote publication 전 상태에서는 preloaded row map으로 존재 여부만 계산하고 per-item repository read와 profile digest 비교를 하지 않는다. `committed`와 `cleanupPending` reconciliation만 exact digest 비교를 유지한다.
- 겹친 claim refresh는 monotonically increasing sequence와 publication generation을 함께 검사해 가장 최근 refresh만 UI state를 publish한다.
- Home recovery action은 failed/deferred checkpoint만으로 나타나지 않고 live eligible count가 1개 이상일 때만 나타난다.
- Claim sheet가 열리면 mount refresh가 끝날 때까지 과거 import/keep action을 숨기고 닫기 가능한 준비 화면을 표시한다. Sheet dismissal은 persistent claim transaction을 삭제하거나 취소하지 않는다.

이 변경은 UI 구성이나 Supabase schema, migration, RLS, Edge Function, WatchConnectivity contract를 변경하지 않는다. 실제 guest inventory가 없을 때 과거 checkpoint를 삭제하지 않으면서도 device-data action과 blocking sheet를 다시 노출하지 않는 것이 핵심이다.
