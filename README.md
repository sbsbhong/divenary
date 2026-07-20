# dive-app

## 프로젝트 목적
Apple Watch 기록과 React Native 모바일 로그북을 함께 다루는 companion app PoC 모노레포입니다.
현재 목표는 완성 앱 개발이 아니라, 모바일 앱이 iPhone app과 embedded watchOS companion app을 함께 소유하는 구조에서 sync contract와 기록/리뷰 경계를 안전하게 발전시키는 것입니다.

핵심 전제:
- 워치 앱은 로그인 없이 로컬 기록과 iPhone 전송 enqueue만 수행
- `userId`는 contract에 포함하지 않음
- 모바일 Google/Apple Auth와 필수 약관 동의, 주체별 local Logbook/Planbook, account local-first outbox와 재개 가능한 guest data claim 기반을 구현함
- Supabase account Logbook/Planbook schema, owner RLS, private profile Storage 경로와 atomic guest claim finalizer를 staging에 배포하고 automated verifier로 검증함. 기기 claim 검증은 아직 완료되지 않음
- 이 앱은 인증된 다이브 컴퓨터, 감압 컴퓨터, 의료기기, 비상 판단 시스템이 아님

## 현재 구현 범위
- Yarn Workspaces 기반 모노레포 구조
- `packages/contracts`:
  - JSON Schema 원본 contract 3종
  - TypeScript 타입 생성(`json-schema-to-typescript`)
  - Swift Codable 타입 생성(`quicktype`)
- `apps/mobile`:
  - React Native `0.85.3` 모바일 앱
  - AsyncStorage 기반 Logbook/Planbook/설정 metadata와 Application Support 파일 기반 session/revision별 Watch profile 분리 저장
  - React Navigation 기반 bottom tab navigation
  - Keychain-compatible session, iOS native Google/Apple credential adapter, guest-preserving login, versioned 필수 약관/개인정보 동의 UI
  - `guest`와 `user:<uuid>`로 분리된 local repository, account local-first outbox/sync, account-copy-wins 목록 합성
  - immutable snapshot/manifest 기반 guest data claim, 원격 readback 검증, commit 뒤 재개 가능한 local cleanup과 기기에 유지 선택
  - runtime watch sync JSON validation, WatchConnectivity pending inbox 수동 동기화, active simulator import/ack 확인 경로
  - 실행하지 않은 Planbook planned dive를 watch companion에 전달하는 PoC
  - Settings 기기 관리에서 공개 `WCSession` paired/install/reachable 상태 표시
- `supabase`:
  - local Supabase configuration, Auth foundation migration/seed, pgTAP와 REST smoke test
  - immutable legal document/current pointer, append-only consent, membership와 RLS/RPC 경계
  - account `dive_logs`/`dive_plans`, owner RLS, private `dive-profiles` bucket, immutable guest claim staging과 atomic finalizer
  - local password fixture와 staging-only promotion/verification 명령
- `packages/supabase`:
  - generated database type, typed client factory, onboarding parser, provider-independent Auth repository
  - typed account Logbook/Planbook/profile 및 guest claim repository
- `apps/mobile/ios/DivenaryWatchApp`:
  - `apps/mobile/ios/Divenary.xcodeproj` 안의 embedded watchOS companion target
  - Start/End 기록 흐름, 원시 live callback과 분리된 최대 1Hz profile, 세션 요약, Application Support 기반 immutable artifact/manifest 저장
  - 저장된 세션 목록/상세 화면
  - 모바일 planned dive 목록 표시와 선택한 계획으로 recording 시작
  - 모든 session body를 단일 WatchConnectivity `transferFile`로 전달하고 revision/SHA-256 ACK로 완료하는 PoC

## 폴더 구조
```text
dive-app/
  apps/
    mobile/
      ios/
        Divenary.xcodeproj/
        Divenary.xcworkspace/
        Divenary/
        DivenaryWatchApp/
      src/
  packages/
    contracts/
      schemas/
      generated/
        typescript/
        swift/
    supabase/
    shared-utils/
  supabase/
    migrations/
    tests/
  package.json
  turbo.json
```

## Contracts 생성 방법
의존성 설치:
```bash
yarn install
```

contracts 생성:
```bash
yarn workspace @repo/contracts generate
```

세부 명령:
```bash
yarn workspace @repo/contracts generate:ts
yarn workspace @repo/contracts generate:swift
```

생성 대상 파일:
- `packages/contracts/generated/typescript/index.ts`
- `packages/contracts/generated/swift/WatchContracts.swift`

## 모바일과 watchOS companion 구조
실행 가능한 iPhone app과 watchOS companion app은 `apps/mobile/ios/Divenary.xcodeproj` 안에서 함께 관리합니다.

Xcode 실행:
```bash
yarn workspace @repo/mobile ios:xcode
```

watchOS companion CLI 빌드 확인:
```bash
yarn watch:build
```

iOS app CLI 빌드 확인:
```bash
yarn ios:build
```

`apps/mobile/ios/DivenaryWatchApp` 주요 구성:
- `Models`: `DepthSample`, `DiveSession`, `DiveSessionSummary`
- `Sensors`: `DepthSensorProvider`, `MockDepthSensorProvider`, `RealDepthSensorProvider`
- `Recording`: `DiveSessionRecorder`
- `Storage`: `DiveSessionStore`
- `Sync`: `WatchSyncEnvelope`, `WatchSyncTransport`
- `Views`: Home, Recording, Summary, Session list/detail 화면

## Auth 로컬 및 staging 개발

일상적인 인증 화면 개발은 실제 Docker local Supabase를 사용합니다. local stack을 시작하거나 초기화한 뒤 fixture를 준비하고, 해당 플랫폼 명령으로 앱을 실행합니다.

```bash
yarn supabase:start
yarn supabase:reset
yarn mobile:auth:local:prepare
yarn mobile:ios:local
# 또는
yarn mobile:android:local
# Metro만 별도로 실행해야 할 때
yarn mobile:start:local
```

`yarn mobile:auth:local:prepare`는 실제 local Auth 사용자를 만들고 `apps/mobile/.env.local`을 생성합니다. 이 파일은 ignored, mode `0600`, local-only 파일이며 생성된 password, session, key를 문서나 추적 파일에 기록하지 않습니다. Local password fixture를 hosted 환경에 사용하거나 hosted 설정과 섞지 않습니다.

Hosted 프로젝트 `mclvhwzsuvsxjerdouka`는 production이 아닌 staging 전용입니다. 이 환경에는 migrations `20260713135707`, `20260719130604`, `20260719134648`, `20260720230000`과 `finalize-guest-claim` Edge Function이 배포되어 있습니다. 마지막 migration은 같은 local row를 다른 target ID로 확정하는 새 claim batch를 transaction에서 거부합니다. 현재 법률 문서 version은 `2026-07-18-staging.1`이며 terms/privacy URL은 promotion 당시의 immutable commit URL을 가리킵니다. staging 명령은 이 project ref만 허용합니다.

```bash
yarn supabase:staging:link
yarn supabase:staging:migrations
yarn supabase:staging:push:dry-run
yarn supabase:staging:push
yarn supabase:staging:seed:auth
yarn supabase:staging:verify:auth
yarn supabase:staging:verify:guest-claim
```

Hosted staging에서는 실제 provider callback을 쓰는 `apps/mobile/.env.development`를 사용합니다. Auth verifier는 exact legal row/effective time/immutable URL, `get_onboarding_status() -> jsonb` metadata, anonymous `42501` denial, Google/Apple enabled flag를 확인했습니다. Guest-claim verifier는 owner RLS, private profile, atomic rollback/idempotency, published payload digest와 target ID 재사용 거부를 확인합니다. Auth verifier는 deployed legal URL에서 promotion SHA를 추론합니다. 같은 promotion commit의 seed 재실행은 idempotent하며, 이후 commit을 새로 promotion하려면 seed 전에 새 legal version과 그 version의 immutable URL을 정의해야 합니다.

사용자는 physical iPhone에서 Apple 로그인을 성공했다고 확인했습니다. Google physical login, cancellation/repeat, session restore와 re-consent는 아직 검증되지 않았습니다. Account Logbook/Planbook migrations와 `finalize-guest-claim` Edge Function은 staging에 배포됐고 disposable user 기반 Auth/guest-claim verifier를 통과했습니다. 이는 physical guest claim 완료를 뜻하지 않습니다.

## 다음 단계

1. [guest data account claim 기기 체크리스트](docs/2026-07-19-guest-data-account-claim-device-checklist.md)의 24 logs + 8 plans, retry/resume, 접근성 matrix를 iPhone/Android에서 수행
2. physical iPhone에서 Google Auth, cancellation/repeat, session restore와 re-consent matrix를 검증
3. Authenticated/guest 상태의 foreground Watch pairing/import/local acknowledgement 회귀와 WatchConnectivity background/force-quit/retry를 paired hardware에서 검증
4. staging과 분리된 production Supabase 프로젝트, production 법률 문서와 앱 내 즉시 영구 계정 삭제를 준비
5. `CMWaterSubmersionManager` 기반 실제 underwater sensor behavior를 지원 hardware의 통제된 환경에서 검증

Apple physical login과 hosted staging guest-claim automated verification은 확인됐지만 Google physical login, physical guest claim, post-Auth Watch 회귀와 account deletion gate는 아직 대기 중이다. Production Supabase와 앱 내 계정 삭제가 준비되기 전에는 release하지 않는다.
