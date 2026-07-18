Source URL: `supabase/`; `packages/supabase/`; `apps/mobile/src/auth/`; `apps/mobile/src/states/auth.tsx`; `apps/mobile/src/screens/auth/`; `apps/mobile/ios/DiveMobile/`; `apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj`; commits `87656b6` through `9696e2e`
Collected: 2026-07-15
Published: 2026-07-15

# Wave 3A Supabase Auth foundation 구현 증거

Status: automated implementation checkpoint complete; hosted physical promotion pending

## 구현된 경계

- Root `supabase/`에는 local configuration, Auth foundation migration/seed, pgTAP, REST smoke harness와 hosted environment에서 격리된 local CLI wrapper가 있다.
- Migration은 `app_memberships`, immutable `legal_documents`, kind별 `current_legal_documents`, append-only `consent_records`, user-id 인자가 없는 onboarding status RPC, current exact set만 원자적으로 받는 completion RPC, explicit Data API grants와 RLS를 만든다.
- `packages/supabase`는 generated database type, typed client factory, onboarding parser와 provider-independent Auth repository를 제공한다. Mobile UI와 native provider SDK에는 의존하지 않는다.
- Mobile은 Keychain-compatible Supabase session storage, native Google/Apple credential adapters, recent-provider preference, server-verified membership cache, Auth state provider, login 화면과 non-dismissible required-consent 화면을 갖는다.
- Auth restore는 unexpired stored session evidence를 online claims, server user, onboarding status와 대조한다. `getClaims()` 또는 `getUser()`의 transport failure에서만 같은 user의 마지막 server-verified complete membership cache와 evidence가 정확히 일치할 때 `authenticatedOffline`을 허용한다. Invalid/rejected session과 onboarding-status RPC 실패는 이 offline fallback 근거가 아니다.
- 같은 verified email identity의 연결은 Supabase Auth automatic linking을 따르고 앱은 email 비교, manual linking/unlinking UI를 제공하지 않는다.
- iPhone target만 Sign in with Apple entitlement와 Google reversed-client callback 설정을 갖는다. Watch target은 Auth entitlement, provider callback, Supabase/provider dependency를 갖지 않는다.
- Public configuration example에는 Supabase URL/publishable key와 Google web/iOS client ID만 빈 값으로 기록한다. Provider secret과 `service_role`은 mobile bundle에 넣지 않는다.
- Guest Logbook/Planbook은 3A 내내 기존 local repository와 `cloudSyncStatus: notConfigured`를 유지한다. Login, consent, cancellation, logout, restore가 guest record를 claim, upload, delete, partition하거나 영구히 숨기지 않는다.

## 구현 커밋

- `87656b6`, `d3136e8`, `1751918`: database Auth foundation, immutable legal snapshot 보정, local Supabase project 격리.
- `684c85f`, `6119475`, `01b82d6`: typed Auth repository와 설계/승격 gate 보정.
- `0f4864b`, `bae773d`: Keychain session과 native Google/Apple credential adapters.
- `93dd96c`, `e2ba722`: Auth state machine, foreground restore/revalidation, latest-intent concurrency 보정.
- `66ce60f`: guest-preserving login과 versioned mandatory-consent UI.
- `c900314`: iPhone-only native social Auth configuration, CocoaPods integration, Watch isolation.
- `9696e2e`: app-owned QueryClient teardown. Full Jest가 assertion 통과 뒤 React Query GC timer를 보유하던 문제를 고쳐 exact test command가 강제 종료 없이 끝나게 했다.

## 2026-07-15 자동 검증

- `yarn supabase:reset`: local migration과 seed 적용 성공.
- `yarn supabase:test:db`: pgTAP 67개 통과.
- `yarn supabase:lint:db`, `yarn supabase:advisors`: schema error와 advisor issue 없음.
- `yarn supabase:local migration list --local`: local/remote column에 migration `20260713135707` 하나가 일치.
- `node supabase/tests/rest/auth-foundation.mjs`: REST Auth foundation smoke test 통과.
- `yarn generate:supabase` 뒤 `packages/supabase/src/database.types.ts` 변경 없음.
- `yarn workspace @repo/supabase test`: 20개 통과. `yarn workspace @repo/supabase typecheck`: 통과.
- `yarn workspace @repo/mobile test --runInBand`: 40 suite, 418 test 통과, exit 0. `--forceExit`를 사용하지 않음.
- `yarn mobile:typecheck`: 통과.
- `yarn ios:build`: unsigned iOS simulator build 통과. 이 결과는 signing/provisioning 또는 실제 provider login 증거가 아니다.
- `yarn watch:build`: watchOS simulator build 통과.
- `yarn codex:check`: contract generation, mobile typecheck, watch build 통과. Generated contract 변경 없음.

## 2026-07-18 local/staging 통합 증거

- 일상적인 authenticated 개발은 실제 Docker local Supabase에서 `yarn supabase:start` 또는 `yarn supabase:reset`, `yarn mobile:auth:local:prepare`, `yarn mobile:ios:local` 또는 `yarn mobile:android:local` 순서로 수행한다. Metro만 필요하면 `yarn mobile:start:local`을 쓴다.
- local fixture는 real local Auth password user를 만든 뒤 ignored `apps/mobile/.env.local`을 mode `0600`으로 원자적으로 생성한다. 이 파일과 생성된 credential은 local-only이며 문서나 tracked configuration에 기록하지 않는다.
- Hosted project `mclvhwzsuvsxjerdouka`는 staging 전용이고 production project가 아니다. Migration `20260713135707`이 적용됐으며, current terms/privacy는 `2026-07-18-staging.1`, `2026-07-18T00:00:00.000Z`이고 promotion commit에 고정된 immutable HTTPS URL을 사용한다.
- guarded staging command는 project ref가 정확히 `mclvhwzsuvsxjerdouka`일 때만 link, migration list, push, legal seed, verification을 수행한다. staging seed는 현재 `HEAD`의 immutable legal URL을 만들고 verifier는 deployed legal URL에서 promotion SHA를 추론하므로 이후 commit 뒤에도 deployed promotion을 안정적으로 확인한다.
- Hosted verifier는 exact legal rows/effective time/immutable URLs, `get_onboarding_status() -> jsonb` metadata, anon `42501` denial, Google/Apple enabled flag를 통과했다. Hosted staging 앱은 실제 provider callback용 `apps/mobile/.env.development`를 쓰며 local password fixture와 섞지 않는다.
- Google/Apple native token exchange, cancellation/repeat, signed callback, session restore는 signed physical device에서 수동으로 검증해야 한다. 이 항목은 verifier 또는 provider enabled flag만으로 통과했다고 주장하지 않는다.
- Guest Logbook/Planbook은 계속 local-only이며 cloud sync나 account claim은 추가하지 않았다. 이 앱은 인증된 다이브 컴퓨터나 생명-critical 판단 시스템이 아니다.

## 물리 승격 gate

다음 값과 증거는 repository에 없으므로 pending이다. Secret 값은 문서나 tracked configuration에 기록하지 않는다.

- Stable owned iPhone App ID/bundle identifier, matching Watch App ID와 companion identifier, signed iPhone/Watch team/profile.
- Exact iPhone App ID의 Sign in with Apple capability와 signed app entitlement inspection.
- Google web/iOS/reversed client IDs, server-only secret, consent audience/test-user status.
- Hosted Supabase URL/publishable key와 Google/Apple provider audience configuration.
- Reviewed immutable app-owned terms/privacy HTTPS URLs와 re-consent용 두 번째 immutable version/current-pointer transition.
- Physical iPhone build/device identifier와 Google/Apple first/repeat/cancel, restart/restore, network loss, refresh/session rejection, required-consent, atomic completion, re-consent matrix.
- Auth 도입 뒤 guest Logbook/Planbook 보존과 foreground Watch pairing/import/local-save/acknowledgement 회귀.

Local seed와 test에서 쓰는 `.invalid` legal URL은 fixture일 뿐 production legal document가 아니다. Unsigned simulator build도 provider console, capability, provisioning 또는 physical login을 입증하지 않는다.

## 후속 범위

- 3B user-owned Logbook/Planbook schema, keyset cursor infinite pagination, private immutable profile Storage와 detail-only fetch는 구현되지 않았다.
- 3C `guest`/`user:<uuid>` partition, explicit bounded guest claim, outbox/retry/conflict는 구현되지 않았다.
- 3D logout account-local purge와 앱 내 즉시 영구 계정 삭제는 구현되지 않았다. 7일 유예 soft deletion/recovery는 그 이후 후속 기능이다.
- Wave 3B는 hosted physical Auth/re-consent와 post-Auth Watch regression 증거 전에는 시작하지 않는다.
- 3A build는 3D의 앱 내 계정 삭제 전에는 release 대상이 아니다.
