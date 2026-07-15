# dive-app

## 프로젝트 목적
Apple Watch 기록과 React Native 모바일 로그북을 함께 다루는 companion app PoC 모노레포입니다.
현재 목표는 완성 앱 개발이 아니라, 모바일 앱이 iPhone app과 embedded watchOS companion app을 함께 소유하는 구조에서 sync contract와 기록/리뷰 경계를 안전하게 발전시키는 것입니다.

핵심 전제:
- 워치 앱은 로그인 없이 로컬 기록과 iPhone 전송 enqueue만 수행
- `userId`는 contract에 포함하지 않음
- Wave 3A의 모바일 Google/Apple Auth와 필수 약관 동의 기반은 구현됐지만, guest Logbook/Planbook은 계속 local-only이며 로그인으로 claim/upload/delete되지 않음
- Supabase remote Logbook/Planbook, cloud backup, guest claim, account-local purge와 계정 삭제는 아직 구현되지 않음
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
  - runtime watch sync JSON validation, WatchConnectivity pending inbox 수동 동기화, active simulator import/ack 확인 경로
  - 실행하지 않은 Planbook planned dive를 watch companion에 전달하는 PoC
  - Settings 기기 관리에서 공개 `WCSession` paired/install/reachable 상태 표시
- `supabase`:
  - local Supabase configuration, Auth foundation migration/seed, pgTAP와 REST smoke test
  - immutable legal document/current pointer, append-only consent, membership와 RLS/RPC 경계
- `packages/supabase`:
  - generated database type, typed client factory, onboarding parser와 provider-independent Auth repository
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

## 다음 단계

1. Stable owned App ID, signing profile, Google/Apple provider, hosted Supabase와 실제 immutable legal URL을 준비하고 physical iPhone Auth/re-consent matrix를 검증
2. Auth 도입 뒤 guest Logbook/Planbook 보존과 foreground Watch pairing/import/local acknowledgement 회귀를 확인
3. WatchConnectivity reconnect, background/force-quit, retry와 large transfer를 paired hardware에서 검증
4. `CMWaterSubmersionManager` 기반 실제 underwater sensor behavior를 지원 hardware의 통제된 환경에서 검증
5. Wave 3B remote data/infinite pagination/profile Storage, 3C local-first sync/guest claim, 3D account-local purge/즉시 영구 계정 삭제를 순서대로 구현

Wave 3A 자동화 체크포인트는 완료됐지만 hosted physical 승격 gate는 아직 대기 중이다. Wave 3B는 그 gate와 post-Auth Watch 회귀 전에는 시작하지 않으며, 앱 내 계정 삭제가 포함된 3D 전에는 release하지 않는다.
