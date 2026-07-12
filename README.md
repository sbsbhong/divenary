# dive-app

## 프로젝트 목적
Apple Watch 기록과 React Native 모바일 로그북을 함께 다루는 companion app PoC 모노레포입니다.
현재 목표는 완성 앱 개발이 아니라, 모바일 앱이 iPhone app과 embedded watchOS companion app을 함께 소유하는 구조에서 sync contract와 기록/리뷰 경계를 안전하게 발전시키는 것입니다.

핵심 전제:
- 워치 앱은 로그인 없이 로컬 기록과 iPhone 전송 enqueue만 수행
- `userId`는 contract에 포함하지 않음
- 워치 데이터는 추후 모바일 앱 로그인 사용자 기준으로 서버 저장 예정
- Supabase/인증/cloud backup은 아직 제외
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
  - runtime watch sync JSON validation, WatchConnectivity pending inbox 수동 동기화, active simulator import/ack 확인 경로
  - 실행하지 않은 Planbook planned dive를 watch companion에 전달하는 PoC
  - Settings 기기 관리에서 공개 `WCSession` paired/install/reachable 상태 표시
- `apps/mobile/ios/DiveWatchApp`:
  - `apps/mobile/ios/DiveMobile.xcodeproj` 안의 embedded watchOS companion target
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
        DiveMobile.xcodeproj/
        DiveMobile.xcworkspace/
        DiveMobile/
        DiveWatchApp/
      src/
  packages/
    contracts/
      schemas/
      generated/
        typescript/
        swift/
    shared-utils/
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
실행 가능한 iPhone app과 watchOS companion app은 `apps/mobile/ios/DiveMobile.xcodeproj` 안에서 함께 관리합니다.

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

`apps/mobile/ios/DiveWatchApp` 주요 구성:
- `Models`: `DepthSample`, `DiveSession`, `DiveSessionSummary`
- `Sensors`: `DepthSensorProvider`, `MockDepthSensorProvider`, `RealDepthSensorProvider`
- `Recording`: `DiveSessionRecorder`
- `Storage`: `DiveSessionStore`
- `Sync`: `WatchSyncEnvelope`, `WatchSyncTransport`
- `Views`: Home, Recording, Summary, Session list/detail 화면

## 다음 단계
1. Apple Watch Ultra 실기기에서 앱 실행 확인
2. WatchConnectivity paired-device delivery, entitlement, background delivery, retry behavior 검증
3. `CMWaterSubmersionManager` 기반 실제 센서 provider 구현
4. Supabase/Auth/cloud backup 설계
