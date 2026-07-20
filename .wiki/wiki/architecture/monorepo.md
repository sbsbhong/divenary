# Monorepo 구조

Sources: pre-Karpathy wiki page, 2026-06-28; Wave 3A Supabase Auth foundation 구현 증거, 2026-07-15; Guest data account claim implementation evidence, 2026-07-20
Raw: [Pre-Karpathy: Monorepo 구조](../../raw/architecture/monorepo.md); [Wave 3A Supabase Auth foundation 구현 증거](../../raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md); [Guest data account claim implementation evidence](../../raw/architecture/2026-07-19-guest-data-account-claim-implementation.md)
Updated: 2026-07-20

## 요약

이 저장소는 Turborepo로 관리되는 Yarn 1 workspace monorepo다. 앱 workspace는 `apps/` 아래, 공유 package는 `packages/` 아래에 있고 root `supabase/`가 local Auth/account-data migration, RLS, private Storage, claim Edge Function과 검증을 관리한다. Account-data와 claim 구현은 staging 대상이지만 hosted staging 배포는 별도 gate다.

## 현재 상태

Root `package.json`의 현재 선언은 다음과 같다.

- `packageManager`: `yarn@1.22.22`
- workspaces: `apps/*`, `packages/*`
- root 개발 의존성: `turbo`

Root script는 다음 역할을 한다.

- `yarn build`: `turbo run build`
- `yarn generate`: `turbo run generate`
- `yarn check:quick`: `yarn generate`를 통한 계약 생성
- `yarn mobile:typecheck`: mobile TypeScript check
- `yarn ios:build`: mobile iOS build wrapper
- `yarn watch:build`: watchOS Xcode build wrapper
- `yarn codex:check`: `check:quick`, `mobile:typecheck`, `watch:build`
- `yarn supabase:local`, `supabase:reset`, `supabase:test:db`, `supabase:lint:db`, `supabase:advisors`: hosted 환경과 격리된 local Supabase lifecycle와 검증
- `yarn generate:supabase`: local schema에서 `packages/supabase/src/database.types.ts` 생성

## 상세

Workspace 책임은 다음과 같다.

- `apps/mobile`: React Native 모바일 앱, iOS native app, embedded watchOS companion target, principal-partitioned local Logbook/Planbook, account outbox/sync, resumable guest claim, watch sync receive/import 경계와 Auth 사용자 흐름을 담당한다.
- `apps/mobile/ios/DivenaryWatchApp`: `apps/mobile` workspace 내부의 SwiftUI watch source다. watch 쪽 기록, 로컬 watch 저장, 동기화 가능한 export payload, WatchConnectivity enqueue PoC를 담당한다.
- `packages/contracts`: JSON Schema contract와 generated TypeScript/Swift contract output을 담당한다.
- `packages/supabase`: generated database type, typed client factory, onboarding parser, provider-independent Auth repository와 typed account Logbook/Planbook/profile/guest claim repository를 담당한다.
- `packages/shared-utils`: 현재 source implementation이 없는 예약된 workspace다.
- `supabase/`: local configuration, Auth/account-data migration과 seed, owner RLS, private `dive-profiles` Storage, guest claim finalizer/Edge Function, pgTAP/REST tests와 hosted 환경에서 격리된 CLI wrapper를 담당한다. 이 repository 구현이 hosted staging에 배포됐다는 증거는 아직 없다.

`packages/contracts/generated/` 아래 output은 생성된 산출물이다. Schema나 generator를 수정한 뒤 generation을 실행해야 하며, generated output을 직접 수정하지 않는다.

Root `turbo.json`은 `build`, `generate`, `lint`, `test` task를 정의한다. `build`와 `generate`는 `generated/**` output을 만들 수 있다.

## 관련 문서

- [모바일 구조](mobile.md)
- [Watch 앱 구조](watch-app.md)
- [동기화 흐름 구조](sync-flow.md)
- [Supabase 구조](supabase.md)
