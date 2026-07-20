Source URL: repository staging deployment and verification commands for project mclvhwzsuvsxjerdouka
Collected: 2026-07-20
Published: 2026-07-20

# Guest data account claim staging promotion evidence

## 배포 대상과 결과

- Hosted project `mclvhwzsuvsxjerdouka`는 production이 아닌 staging 전용이다.
- Migration dry-run은 `20260719130604_create_account_data_and_guest_claim.sql`과 `20260719134648_add_guest_claim_finalizer.sql`만 제시했다.
- 두 migration을 staging에 적용했고 이후 local/remote migration history가 세 migration 모두 일치했다.
- `finalize-guest-claim` Edge Function을 같은 staging project에 배포했다.
- `yarn supabase:staging:verify:auth`는 legal documents, onboarding RPC와 Google/Apple provider enabled 상태를 확인하고 exit code 0으로 끝났다.
- `yarn supabase:staging:verify:guest-claim`은 disposable user 두 명으로 owner RLS, private profile object, atomic finalization, committed readback과 idempotency를 확인하고 `PASS staging guest claim verification`으로 끝났다. Verifier는 test object와 user를 정리했다.

## 자동 검증 근거

- Local Supabase reset 뒤 pgTAP 109 tests, Auth foundation REST smoke, guest claim REST smoke와 finalizer 15 checks가 통과했다.
- `@repo/supabase` tests 53건과 typecheck가 통과했다.
- Staging verifier unit tests 49건이 통과했다.
- Guest claim, account state/outbox/sync, principal repositories, Watch import, claim/settings UI를 포함한 focused mobile 16 suites 326 tests가 통과했다.
- `yarn check:quick`, mobile typecheck, arm64 iOS Simulator compile과 watchOS build가 통과했다.
- Repository-wide mobile suite의 native Watch source assertion 12건과 lint 28 errors는 feature branch와 base에서 동일하게 재현되는 기존 gate다. Guest claim focused tests의 실패는 아니다.

## 승격 경계

- 이 증거는 hosted staging schema/Function과 automated remote behavior의 승격만 뜻한다.
- iPhone/Android 24 logs + 8 plans claim, exact progress 관찰, offline/force-quit resume, 접근성, second-account isolation은 physical device에서 아직 검증하지 않았다.
- 사용자는 physical iPhone Apple login 성공을 확인했지만 Google physical login은 아직 검증하지 않았다.
- Committed claim rows/profile objects는 idempotent readback/audit 근거로 보존된다. Storage lifecycle cleanup과 앱 내 즉시 영구 account deletion은 future release gate다.
- Production Supabase에는 이 promotion을 적용하지 않았다.
