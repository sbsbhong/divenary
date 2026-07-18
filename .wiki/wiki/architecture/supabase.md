# Supabase 구조

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Wave 3 Supabase/Auth 승인 결정, 2026-07-13; Wave 3A Auth 설계 검토 보정, 2026-07-13; Supabase Auth 2.110.2 lock strategy correction, 2026-07-15; Wave 3A Supabase Auth foundation 구현 증거, 2026-07-15, updated 2026-07-18; Divenary Auth promotion readiness evidence, 2026-07-15; Google iOS client and callback correction, 2026-07-16
Raw: [Pre-Karpathy: Supabase 구조](../../raw/architecture/supabase.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Wave 3 Supabase/Auth 승인 결정](../../raw/architecture/2026-07-13-wave3-supabase-auth-decisions.md); [Wave 3A Auth 설계 검토 보정](../../raw/architecture/2026-07-13-wave3-auth-design-review.md); [Supabase Auth 2.110.2 lock strategy correction](../../raw/architecture/2026-07-15-supabase-auth-lock-strategy.md); [Wave 3A Supabase Auth foundation 구현 증거](../../raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md); [Divenary Auth promotion readiness evidence](../../raw/architecture/2026-07-15-divenary-auth-promotion-readiness.md); [Google iOS client and callback correction](../../raw/architecture/2026-07-16-google-ios-callback-correction.md)
Updated: 2026-07-18

## 요약

Wave 3A의 local Supabase/Auth 자동화 기반과 staging Auth promotion은 완료됐다. Hosted project `mclvhwzsuvsxjerdouka`는 staging 전용이며 production이 아니다. 실기기 Google/Apple Auth와 re-consent 승격 gate, remote data 3B, local-first sync 3C, account lifecycle 3D는 여전히 분리된 후속 범위다.

## 현재 상태

Wave 3A 자동 구현 checkpoint는 완료됐다. Root `supabase/`에는 local config, Auth foundation migration/seed, pgTAP, REST smoke harness와 hosted 환경 변수에서 격리된 local CLI wrapper가 있다. `packages/supabase`에는 generated database type, typed client factory, runtime onboarding parser와 provider-independent Auth repository가 있다. Mobile에는 Keychain-compatible session, native Google/Apple credential adapter, restore/revalidation state, guest-preserving login과 versioned mandatory-consent UI가 있다. Remote data, outbox와 account deletion은 아직 없다. 사용자가 실기기 foreground에서 약 4분 세션의 pairing, 모바일 자동 import, local save 뒤 Watch `synced` 전환을 확인했지만 이는 Auth 도입 전 기준선이며 post-Auth regression, reconnect, background, killed-app, large transfer 증거는 아니다.

Divenary rename 뒤 `com.divenary.app`과 embedded `com.divenary.app.watchkitapp`의 generic physical-device Debug build, automatic provisioning, strict signature verification이 통과했다. Signed iPhone app에만 Apple Sign In entitlement가 있고 Watch app에는 없다. Main checkout의 ignored development env에는 유효한 Google iOS Client ID가 있으며, 여기서 산출한 reversed callback scheme을 iPhone Debug/Release에 설정했다. 이전 worktree에는 ignored env가 복사되지 않아 이를 Client ID 부재로 잘못 기록했다. Watch에는 Google callback을 넣지 않는다. Apple provider 설정은 사용자 보고 상태이며 hosted provider audience, production legal URL/current pointer와 실제 Auth token exchange는 physical matrix에서 검증해야 한다.

3A는 iOS native Google/Apple login과 Keychain-compatible session을 구현한다. 데이터베이스는 `app_memberships`, immutable `legal_documents`, kind별 `current_legal_documents` pointer, append-only `consent_records`를 분리한다. User id 인자가 없는 status RPC가 현재 필수 동의 coverage를 계산하므로 membership이 이미 있어도 새 current version에는 재동의해야 한다. Completion RPC는 current terms/privacy exact set만 원자적으로 기록하고 active Auth session을 확인한다. Login과 consent는 기존 guest Logbook/Planbook을 claim, upload, delete, partition하거나 영구히 숨기지 않으며 `cloudSyncStatus: notConfigured`를 유지한다.

Supabase table은 RLS만으로 노출되지 않는 2026 Data API 권한 모델을 적용해 최소 `GRANT`도 migration에 명시한다. Session bootstrap은 `getSession()`만 신뢰하지 않고 online claims/user/status 검증을 수행한다. `getClaims()` 또는 `getUser()` transport failure 때만 unexpired stored session evidence와 같은 user의 마지막 server-verified complete cache가 정확히 일치하면 local-only offline state를 허용한다. Invalid session, server rejection 또는 onboarding-status RPC 실패는 offline fallback 근거가 아니다. Client concurrency는 설치된 `auth-js@2.110.2`의 기본 lockless single-flight/commit guard를 사용하며 deprecated `processLock` custom option은 추가하지 않는다.

로컬 Supabase 명령은 격리된 launcher를 통해 실행한다. Root local CLI wrapper와 type generator/REST harness의 sanitized child environment는 shell에 주입된 다른 hosted project의 `SUPABASE_PROJECT_ID`와 access token을 제거하므로 local stack, migration test, type generation이 repository `config.toml`의 독립 project context만 사용한다. 일상적인 authenticated 개발은 실제 Docker local Supabase에서 `yarn supabase:start` 또는 `yarn supabase:reset`, `yarn mobile:auth:local:prepare`, `yarn mobile:ios:local` 또는 `yarn mobile:android:local`로 수행하고, Metro만 필요할 때는 `yarn mobile:start:local`을 사용한다. fixture가 만드는 ignored `apps/mobile/.env.local`은 mode `0600`의 local-only 파일이며 credential을 문서나 tracked configuration에 기록하지 않는다.

Hosted promotion 명령은 local path와 명시적으로 분리한다. `mclvhwzsuvsxjerdouka`는 staging 전용 project ref이며 `20260713135707` migration이 적용됐다. current terms/privacy는 `2026-07-18-staging.1`, `2026-07-18T00:00:00.000Z`, promotion commit에 고정된 immutable HTTPS URL이다. guard는 정확한 project ref만 허용하고 verifier는 exact legal row/effective time/URL, `get_onboarding_status() -> jsonb` metadata, anonymous `42501` denial, Google/Apple enabled flag를 확인한다. verifier는 deployed legal URL에서 promotion SHA를 추론하므로 이후 commit에서도 deployed promotion을 확인하고, seed는 current `HEAD`에서 새 immutable URL을 만든다. Hosted staging은 실제 provider callback용 `apps/mobile/.env.development`를 쓰며 local password fixture와 섞지 않는다.

같은 verified email의 OAuth identity는 Supabase Auth의 automatic linking을 따르되 app code는 email을 비교하거나 manual linking UI를 제공하지 않는다. Authorization은 `auth.uid()`만 사용한다. Email/password, magic link, SMS, Android native Auth, nickname/profile/friends, marketing consent는 범위 밖이다.

## 상세

Supabase가 도입될 때 책임은 다음과 같다.

- `supabase/`: local configuration, migration, RLS, seed, database test, privileged account deletion boundary.
- `packages/supabase`: generated database type, typed client factory, Auth와 Logbook/Planbook/profile repository. React Native UI와 native provider SDK에는 의존하지 않는다.
- `apps/mobile`: 현재 Keychain-compatible session adapter, native Google/Apple credential adapter와 Auth state/UI를 소유한다. Principal-scoped local repository, outbox와 account cache는 3C/3D 후속이다.
- Watch app: 기존 local capture와 iPhone sync만 담당한다. Supabase client, account id, cloud business logic을 갖지 않는다.

로컬 principal은 `guest`와 `user:<uuid>`로 분리한다. Guest는 local-only다. Account 연결은 명시적 동의를 받은 뒤 persistent manifest와 bounded batch를 사용해 copy, remote/profile 검증, source removal 순서로 수행한다. Logout은 현재 account의 session, local partition, query cache, downloaded profile을 기기에서 제거하고 guest partition을 보존한다.

Logbook은 `(started_at desc, id desc)`, Planbook은 `(planned_at desc, id desc)` keyset cursor와 기본 page size 30을 사용한다. 목록에는 typed metadata와 최대 160개 preview sample만 포함한다. 전체 1Hz profile은 private `dive-profiles/<user_id>/<dive_log_id>/<content_revision>.json` immutable object로 저장하고 detail에서만 다운로드한다.

Signed-in write는 local save 뒤 idempotent outbox가 전달한다. Remote row `revision`이 expected revision과 다르면 local mutation을 `conflict`로 보존하고 remote latest를 가져온다. Watch `session.syncStatus: synced`는 iPhone local import acknowledgement이고 remote cloud 성공과 독립적이다.

3D의 계정 삭제는 앱 안에서 재확인 뒤 즉시 영구 삭제한다. 7일 유예 soft deletion/recovery는 후속 기능이다. `service_role`과 provider secret은 mobile bundle에 두지 않는다. Local seed의 `.invalid` legal URL은 test fixture이며 production 법률 문서가 아니다.

Stable Divenary App ID, signed provisioning과 Google iOS client/reversed callback은 확보됐다. staging provider/legal 설정과 verifier는 통과했지만, Google/Apple native token exchange, cancellation/repeat, signed callback, session restore와 re-consent는 signed physical device의 수동 승격 gate다. Provider enabled flag나 staging verifier만으로 이 결과를 주장하지 않는다. Guest Logbook/Planbook은 계속 local-only이며 cloud sync나 account claim은 없다. Production project와 production legal document는 future work이고, 3A는 앱 내 계정 삭제가 추가되는 3D 전까지 App Store release 대상이 아니다.

## 관련 문서

- [모바일 구조](mobile.md)
- [모바일 로그북 로드맵](mobile-logbook-roadmap.md)
- [동기화 흐름 구조](sync-flow.md)
- [다이브 로그 도메인](../domains/dive-log.md)
- [ADR: Local-first mobile logbook with future Supabase sync](../decisions/adr-local-first-mobile-logbook.md)
- [열린 질문](../questions/open-questions.md)
