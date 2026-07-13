# Supabase 구조

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Wave 3 Supabase/Auth 승인 결정, 2026-07-13
Raw: [Pre-Karpathy: Supabase 구조](../../raw/architecture/supabase.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Wave 3 Supabase/Auth 승인 결정](../../raw/architecture/2026-07-13-wave3-supabase-auth-decisions.md)
Updated: 2026-07-13

## 요약

현재 저장소에는 구현된 Supabase 영역이 없지만 Wave 3의 Auth, 데이터 소유권, 목록 pagination, profile Storage, local-first sync, logout과 계정 삭제 정책은 승인됐다. 구현은 3A Auth foundation, 3B remote data, 3C local-first sync, 3D account lifecycle 순서로 진행한다.

## 현재 상태

root `supabase/`와 `packages/supabase`는 아직 없다. Supabase client, generated database type, migration, RLS policy, Auth UI, remote repository, outbox도 구현되지 않았다. 사용자가 실기기 foreground에서 약 4분 세션의 pairing, 모바일 자동 import, local save 뒤 Watch `synced` 전환을 확인했지만 reconnect, background, killed-app, large transfer까지 검증된 것은 아니다.

3A는 iOS native Google/Apple login, Keychain session, `app_memberships`, versioned `legal_documents`/`consent_records`, current required consent를 한 transaction에서 기록하는 onboarding RPC를 만든다. 같은 verified email의 OAuth identity는 Supabase Auth의 automatic linking을 따르되 app code는 email을 비교하거나 manual linking UI를 제공하지 않는다. Authorization은 `auth.uid()`만 사용한다. Email/password, magic link, SMS, Android native Auth, nickname/profile/friends, marketing consent는 범위 밖이다.

## 상세

Supabase가 도입될 때 책임은 다음과 같다.

- `supabase/`: local configuration, migration, RLS, seed, database test, privileged account deletion boundary.
- `packages/supabase`: generated database type, typed client factory, Auth와 Logbook/Planbook/profile repository. React Native UI와 native provider SDK에는 의존하지 않는다.
- `apps/mobile`: Keychain session adapter, native Google/Apple credential adapter, Auth state/UI, principal-scoped local repository, outbox와 account cache.
- Watch app: 기존 local capture와 iPhone sync만 담당한다. Supabase client, account id, cloud business logic을 갖지 않는다.

로컬 principal은 `guest`와 `user:<uuid>`로 분리한다. Guest는 local-only다. Account 연결은 명시적 동의를 받은 뒤 copy, remote/profile 검증, source removal 순서로 수행한다. Logout은 현재 account의 session, local partition, query cache, downloaded profile을 기기에서 제거하고 guest partition을 보존한다.

Logbook은 `(started_at desc, id desc)`, Planbook은 `(planned_at desc, id desc)` keyset cursor와 기본 page size 30을 사용한다. 목록에는 typed metadata와 최대 160개 preview sample만 포함한다. 전체 1Hz profile은 private `dive-profiles/<user_id>/<dive_log_id>/<content_revision>.json` immutable object로 저장하고 detail에서만 다운로드한다.

Signed-in write는 local save 뒤 idempotent outbox가 전달한다. Remote row `revision`이 expected revision과 다르면 local mutation을 `conflict`로 보존하고 remote latest를 가져온다. Watch `session.syncStatus: synced`는 iPhone local import acknowledgement이고 remote cloud 성공과 독립적이다.

계정 삭제는 앱 안에서 재확인 뒤 즉시 영구 삭제한다. 7일 유예 soft deletion/recovery는 후속 기능이다. `service_role`과 provider secret은 mobile bundle에 두지 않는다.

## 관련 문서

- [모바일 구조](mobile.md)
- [모바일 로그북 로드맵](mobile-logbook-roadmap.md)
- [동기화 흐름 구조](sync-flow.md)
- [다이브 로그 도메인](../domains/dive-log.md)
- [ADR: Local-first mobile logbook with future Supabase sync](../decisions/adr-local-first-mobile-logbook.md)
- [열린 질문](../questions/open-questions.md)
