Source URL: docs/superpowers/specs/2026-07-26-device-claim-live-inventory-design.md; apps/mobile/src/claim/guest-claim-service.ts; apps/mobile/src/states/account-data.tsx; apps/mobile/src/screens/settings/screen.tsx; apps/mobile/src/screens/account-claim/screen.tsx
Collected: 2026-07-26
Published: 2026-07-26

# Device claim live inventory correction

실기기에서 `이 기기에만 저장` 로그를 모두 삭제한 뒤 Settings의 `기기 데이터 가져오기`가 처음에는 `0`을 보이다가 검사 뒤 과거 snapshot의 `15`로 바뀌었다. Claim sheet가 열린 동안 하단 탭을 터치할 수 없고, pending 검사 중 `기기에 유지`도 즉시 닫히지 않았다.

원인은 현재 guest repository inventory와 user-scoped `GuestClaimSnapshot`의 item/retained/failure count를 하나의 기기 데이터 개수처럼 표시한 것이었다. Composed guest repository의 save/delete는 React Query 목록만 갱신하고 claim eligibility를 다시 읽지 않았다. `GuestClaimService.prepare()`는 remote progress가 없는 `prepared`, `deferred`, `failed` snapshot도 현재 source 존재 여부를 확인하지 않고 retry했다.

승인된 수정은 live guest inventory와 transaction checkpoint를 분리한다.

- Settings와 자동 claim sheet 조건은 `guestRepositories.logbook.list()`와 `guestRepositories.planbook.list()`에서 계산한 live count만 사용한다.
- Composed guest save/delete 뒤 provider가 inventory revision을 발행하고 claim presentation을 다시 계산한다.
- Remote progress가 없는 local checkpoint에서 snapshot source가 삭제됐으면 snapshot을 제거하고 현재 inventory로 다시 준비한다.
- Snapshot 이후 추가되거나 변경된 row는 기존 account promotion/outbox 경로가 보존하므로 checkpoint를 폐기하지 않는다.
- `remoteBatchId`가 있는 checkpoint와 `running`, `finalizing`, `cleanupPending` 복구 경계는 유지한다.
- live count가 `0`이면 Settings import row를 숨긴다.
- Native form sheet는 mount에서 inventory를 refresh하고, 준비·진행 중에도 닫을 수 있다. Sheet dismissal은 provider가 소유한 claim Promise나 persistent checkpoint를 취소하지 않는다.
- `기기에 유지`는 navigation을 먼저 닫고 defer persistence를 계속한다.

회귀 테스트는 삭제된 deferred snapshot이 remote call 없이 제거되는지, remote-progress checkpoint와 post-snapshot promotion이 유지되는지, device-only 마지막 row 삭제 뒤 eligibility가 `1 → 0`이 되는지, stale failed/retained total이 Settings count를 대체하지 않는지, pending claim 중 sheet를 닫을 수 있는지 확인한다.

Focused Jest 검증은 7개 suite 158개 test를 통과했고 worktree TypeScript `tsc --noEmit`이 성공했다. Supabase schema, migration, RLS, Edge Function, WatchConnectivity contract와 watchOS source는 변경하지 않았다. Physical iPhone에서 삭제·재실행·새 guest row·claim을 잇는 최종 확인은 별도 gate다.
