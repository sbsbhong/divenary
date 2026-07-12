# ADR: Local-first mobile logbook with future Supabase sync

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12
Raw: [Pre-Karpathy: ADR: Local-first mobile logbook with future Supabase sync](../../raw/decisions/adr-local-first-mobile-logbook.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md)
Updated: 2026-07-12

## 요약

모바일 로그북은 Supabase와 인증을 먼저 붙이지 않고 local-first 저장소 경계 위에서 구현한다. 수동 로그와 watch 기반 로그를 모두 `DiveLogEntry`로 다루고, React Query는 저장소가 아니라 조회/변경 orchestration 계층으로만 사용한다.

## Status

Accepted

## Context

모바일 앱은 현재 watch fixture에서 가져온 세션을 React state로 보여준다. 사용자는 모바일에서 직접 로그를 등록하는 흐름과 watch에서 기록한 세션을 바탕으로 로그를 완성하는 흐름을 모두 필요로 한다. 장기적으로는 로그인과 Supabase 동기화가 필요하지만, 지금 바로 인증, RLS, migration, sync failure 처리를 함께 구현하면 모바일 로그 작성 경험을 검증하기 전에 범위가 커진다.

## Decision

모바일 로그북은 local-first로 구현한다. 첫 구현은 로그인 없이 기기 로컬 저장소에 로그를 저장한다. 단, `DiveLogEntry`와 저장소 인터페이스를 먼저 도입해서 나중에 Supabase 저장소와 동기화 계층을 붙일 수 있게 한다.

모바일 로그에는 `manual`과 `watch` source를 둘 다 허용한다. `WatchSession`은 watch 동기화 계약이고, 모바일 사용자가 보는 최종 로그 항목은 별도 `DiveLogEntry`로 둔다. Watch에서 가져온 측정값은 원본 출처를 보존하고 모바일 편집 화면에서 잠금 값으로 표시한다. 사용자가 입력하거나 모바일이 제안한 값은 별도 provenance로 구분한다.

React Query는 모바일 로그북의 조회와 변경을 다루는 cache/mutation 계층으로 사용한다. `useQuery`와 `useMutation`은 `DiveLogRepository`를 호출한다. React Query cache는 실제 저장소가 아니며, local storage와 future Supabase row가 durable store다.

Zustand는 첫 구현 범위에서 제외한다. 추후 로그 편집 화면의 draft, step, 선택 상태가 복잡해질 때 client-state store로 재검토한다.

로그인 기능이 추가되기 전 모든 항목의 `cloudSyncStatus`는 `notConfigured`다. 로그인 사용자는 local write 후 Supabase outbox sync를 수행하고, 기존 guest 로그를 계정에 연결할 때는 사용자 동의를 받는다.

## Consequences

- 수동 로그 등록을 Supabase 없이 먼저 구현할 수 있다.
- 로컬 저장소는 임시 코드가 아니라 guest mode와 future offline cache의 기반이 된다.
- 화면 코드는 저장소 구현을 직접 알지 않게 된다.
- React Query를 사용해 local repository와 future syncing repository의 loading/error/mutation 처리를 같은 방식으로 다룰 수 있다.
- Zustand를 미리 도입하지 않아 첫 구현의 상태 관리 범위를 줄인다.
- Supabase schema와 RLS는 로그 모델이 안정된 뒤 설계한다.
- Watch-captured 값은 출처 표시가 가능하지만, certified dive computer처럼 표현하지 않는다.
- 첫 구현 전 local storage engine 선택은 별도 Phase 0 조사에서 결정한다.

## Sources

- `apps/mobile/src/states/use-dive-logbook.ts`
- `apps/mobile/src/types/dive-session.ts`
- `apps/mobile/src/utils/import-watch-session.ts`
- `apps/mobile/ios/DiveWatchApp/Models/DiveSession.swift`
- `packages/contracts/schemas/watch-session.schema.json`
- `docs/superpowers/specs/2026-06-21-mobile-logbook-local-first-design.md`
- `docs/superpowers/plans/2026-06-21-mobile-logbook-local-first.md`
