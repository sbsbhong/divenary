# Supabase 구조

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12
Raw: [Pre-Karpathy: Supabase 구조](../../raw/architecture/supabase.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md)
Updated: 2026-07-12

## 요약

현재 저장소에는 구현된 Supabase 영역이 없다.

## 현재 상태

저장소에는 root `supabase/` directory나 `packages/supabase` workspace가 없다. 현재 코드에는 Supabase client initialization, generated database type, migration, RLS policy, repository layer, edge function, auth flow가 없다.

## 상세

Supabase가 도입될 때 의도된 책임은 다음과 같다.

- `supabase/`: migration, RLS policy, seed data, database function, 필요 시 edge function.
- `packages/supabase`: Supabase client initialization, generated database type, repository/query function, Supabase 전용 mapping logic.

Schema change는 migration 중심으로 진행해야 한다. 새 table이나 변경된 table은 RLS policy, 지원되는 경우 generated type update, repository update, Supabase 구조와 dive-log domain wiki 수정과 함께 다룬다.

Watch sync contract는 현재 `userId`를 생략한다. 사용자 소유권은 watch-side capture가 아니라 인증된 mobile/server context에서 붙여야 한다.

Local-first 저장소 경계는 준비됐고 Supabase/Auth 전체 구현은 pre-real-dive P0다. 실제 구현 전 guest data 연결 동의, 로그아웃·계정 삭제·중복·conflict 정책을 별도 spec으로 확정한다. 이후 local Supabase project, user-owned schema와 RLS, generated database type, client, remote repository, outbox/retry, cloud backup, media storage 순서로 진행한다.

모바일 `DiveLogEntry.cloudSyncStatus`는 현재 `notConfigured`다. Raw Watch `session.syncStatus`와 별개이며, backend와 outbox가 구현되기 전에는 cloud 상태 filter나 성공·대기·실패 pill을 표시하지 않는다. Mobile code는 direct SQL을 사용하지 않고 repository 경계 뒤에서 remote storage를 다룬다.

## 관련 문서

- [모바일 구조](mobile.md)
- [모바일 로그북 로드맵](mobile-logbook-roadmap.md)
- [동기화 흐름 구조](sync-flow.md)
- [다이브 로그 도메인](../domains/dive-log.md)
- [ADR: Local-first mobile logbook with future Supabase sync](../decisions/adr-local-first-mobile-logbook.md)
- [열린 질문](../questions/open-questions.md)
