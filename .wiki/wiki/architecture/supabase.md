# Supabase 구조

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Wave 3 Supabase/Auth 승인 결정, 2026-07-13; Wave 3A Auth 설계 검토 보정, 2026-07-13; Supabase Auth 2.110.2 lock strategy correction, 2026-07-15
Raw: [Pre-Karpathy: Supabase 구조](../../raw/architecture/supabase.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Wave 3 Supabase/Auth 승인 결정](../../raw/architecture/2026-07-13-wave3-supabase-auth-decisions.md); [Wave 3A Auth 설계 검토 보정](../../raw/architecture/2026-07-13-wave3-auth-design-review.md); [Supabase Auth 2.110.2 lock strategy correction](../../raw/architecture/2026-07-15-supabase-auth-lock-strategy.md)
Updated: 2026-07-15

## 요약

현재 저장소에는 구현된 Supabase 영역이 없지만 Wave 3의 Auth, 데이터 소유권, 목록 pagination, profile Storage, local-first sync, logout과 계정 삭제 정책은 승인됐다. 구현은 3A Auth foundation, 3B remote data, 3C local-first sync, 3D account lifecycle 순서로 진행한다.

## 현재 상태

Wave 3A 구현이 진행 중이다. Root `supabase/`에는 local config, auth foundation migration/seed, pgTAP, REST smoke harness와 hosted 환경 변수에서 격리된 local CLI wrapper가 있다. `packages/supabase`에는 generated database type, typed client factory, runtime onboarding parser와 provider-independent Auth repository가 있다. Mobile Keychain/native provider/Auth UI와 remote data/outbox는 아직 구현되지 않았다. 사용자가 실기기 foreground에서 약 4분 세션의 pairing, 모바일 자동 import, local save 뒤 Watch `synced` 전환을 확인했지만 reconnect, background, killed-app, large transfer까지 검증된 것은 아니다.

3A는 iOS native Google/Apple login과 Keychain session을 만든다. 데이터베이스는 `app_memberships`, immutable `legal_documents`, kind별 `current_legal_documents` pointer, append-only `consent_records`를 분리한다. User id 인자가 없는 status RPC가 현재 필수 동의 coverage를 계산하므로 membership이 이미 있어도 새 current version에는 재동의해야 한다. Completion RPC는 current terms/privacy exact set만 원자적으로 기록하고 active Auth session을 확인한다.

Supabase table은 RLS만으로 노출되지 않는 2026 Data API 권한 모델을 적용해 최소 `GRANT`도 migration에 명시한다. Session bootstrap은 `getSession()`만 신뢰하지 않고 online claims/user/status 검증을 수행한다. Network failure 때는 unexpired stored session evidence와 마지막 server-verified cache가 정확히 일치할 때만 local-only offline state를 허용한다. Client concurrency는 설치된 `auth-js@2.110.2`의 기본 lockless single-flight/commit guard를 사용하며 deprecated `processLock` custom option은 추가하지 않는다.

로컬 Supabase 명령은 격리된 launcher를 통해 실행한다. Root local CLI wrapper와 type generator/REST harness의 sanitized child environment는 shell에 주입된 다른 hosted project의 `SUPABASE_PROJECT_ID`와 access token을 제거하므로 local stack, migration test, type generation이 repository `config.toml`의 독립 project context만 사용한다. Hosted promotion 명령은 이 local path와 명시적으로 분리한다.

같은 verified email의 OAuth identity는 Supabase Auth의 automatic linking을 따르되 app code는 email을 비교하거나 manual linking UI를 제공하지 않는다. Authorization은 `auth.uid()`만 사용한다. Email/password, magic link, SMS, Android native Auth, nickname/profile/friends, marketing consent는 범위 밖이다.

## 상세

Supabase가 도입될 때 책임은 다음과 같다.

- `supabase/`: local configuration, migration, RLS, seed, database test, privileged account deletion boundary.
- `packages/supabase`: generated database type, typed client factory, Auth와 Logbook/Planbook/profile repository. React Native UI와 native provider SDK에는 의존하지 않는다.
- `apps/mobile`: Keychain session adapter, native Google/Apple credential adapter, Auth state/UI, principal-scoped local repository, outbox와 account cache.
- Watch app: 기존 local capture와 iPhone sync만 담당한다. Supabase client, account id, cloud business logic을 갖지 않는다.

로컬 principal은 `guest`와 `user:<uuid>`로 분리한다. Guest는 local-only다. Account 연결은 명시적 동의를 받은 뒤 persistent manifest와 bounded batch를 사용해 copy, remote/profile 검증, source removal 순서로 수행한다. Logout은 현재 account의 session, local partition, query cache, downloaded profile을 기기에서 제거하고 guest partition을 보존한다.

Logbook은 `(started_at desc, id desc)`, Planbook은 `(planned_at desc, id desc)` keyset cursor와 기본 page size 30을 사용한다. 목록에는 typed metadata와 최대 160개 preview sample만 포함한다. 전체 1Hz profile은 private `dive-profiles/<user_id>/<dive_log_id>/<content_revision>.json` immutable object로 저장하고 detail에서만 다운로드한다.

Signed-in write는 local save 뒤 idempotent outbox가 전달한다. Remote row `revision`이 expected revision과 다르면 local mutation을 `conflict`로 보존하고 remote latest를 가져온다. Watch `session.syncStatus: synced`는 iPhone local import acknowledgement이고 remote cloud 성공과 독립적이다.

계정 삭제는 앱 안에서 재확인 뒤 즉시 영구 삭제한다. 7일 유예 soft deletion/recovery는 후속 기능이다. `service_role`과 provider secret은 mobile bundle에 두지 않는다.

Stable owned App ID, provider console 설정, 실제 immutable 약관/개인정보 URL, signed provisioning, hosted test project, physical iPhone은 자동 구현과 분리된 승격 gate다. 3A는 앱 내 계정 삭제가 추가되는 3D 전까지 App Store release 대상이 아니다.

## 관련 문서

- [모바일 구조](mobile.md)
- [모바일 로그북 로드맵](mobile-logbook-roadmap.md)
- [동기화 흐름 구조](sync-flow.md)
- [다이브 로그 도메인](../domains/dive-log.md)
- [ADR: Local-first mobile logbook with future Supabase sync](../decisions/adr-local-first-mobile-logbook.md)
- [열린 질문](../questions/open-questions.md)
