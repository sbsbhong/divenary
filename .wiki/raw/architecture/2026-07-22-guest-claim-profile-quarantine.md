Source URL: docs/superpowers/specs/2026-07-22-guest-claim-profile-quarantine-design.md
Collected: 2026-07-22
Published: 2026-07-22

# Guest claim profile quarantine

실기기에서 `기기 데이터 가져오기`가 `0 / 14`에서 즉시 실패했다. Hosted staging account-data/RLS/guest-claim verifier는 통과했고 해당 시도에는 원격 batch가 생성되지 않았다. 실패는 원격 upload 전 local watch profile 검증에서 발생했다.

사용자는 접근 A를 승인했다. Watch profile을 안전하게 확인할 수 없는 log 하나 때문에 관계없는 정상 항목의 claim을 막지 않는다. 정상 항목만 immutable remote manifest에 포함하고, 확인할 수 없는 log와 연결된 plan은 guest 원본 그대로 기기에 보류한다. 보류 항목은 remote expected count, account publication과 exact guest cleanup에서 제외한다.

부분 완료 결과는 가져온 수와 기기에 유지한 수를 분리해 표시한다. 보류 항목만 남은 상태는 generic `0 / N` 실패와 자동 재시도를 반복하지 않는다. 사용자가 Settings에서 `다시 검사`를 명시적으로 선택한 경우에만 현재 guest 원본으로 새 preflight를 수행한다. Supabase schema/RLS/Edge Function과 watchOS contract는 변경하지 않는다.

구현 source는 `apps/mobile/src/claim/guest-claim-store.ts`, `apps/mobile/src/claim/guest-claim-service.ts`, `apps/mobile/src/states/account-data.tsx`, `apps/mobile/src/screens/account-claim/screen.tsx`다.
