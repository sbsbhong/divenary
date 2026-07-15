# 프로젝트 개요

Sources: pre-Karpathy wiki page, 2026-06-28; Wave 3A Supabase Auth foundation 구현 증거, 2026-07-15
Raw: [Pre-Karpathy: 프로젝트 개요](../../raw/project/overview.md); [Wave 3A Supabase Auth foundation 구현 증거](../../raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md)
Updated: 2026-07-15

## 요약

`diving-app`은 레크리에이션 다이빙 로그 보조 앱을 위한 Yarn 1/Turborepo monorepo다. 현재 구현은 bare React Native 모바일 앱, 모바일 iOS project 안의 embedded SwiftUI watchOS companion target, 공유 watch 동기화 계약, Wave 3A Supabase/Auth package와 local migration, 비어 있는 공유 utility package를 함께 관리한다.

## 현재 상태

이 앱은 certified dive computer, 감압 컴퓨터, 의료기기, 생명 유지 장치가 아니다. 현재 화면은 watch에서 기록한 세션, 로컬 확인, 모바일 로그북 미리보기, 계획 알림, 앱 표시 설정에 집중한다.

현재 사용하는 workspace는 다음과 같다.

- `apps/mobile`: React Native `0.85.3` 앱과 iOS/watchOS companion project. 자체 tab navigation, React Query 기반 로그북 조회/변경, AsyncStorage 기반 persistent repository, watch fixture 가져오기, WatchConnectivity receiver PoC, 수동 로그 작성, 계획 알림, 앱 표시 설정과 Keychain-compatible native social Auth/mandatory consent를 포함한다. `apps/mobile/ios/DiveMobile.xcodeproj` 안에 iPhone target `DiveMobile`과 watch target `DiveWatchApp`가 있고, watch source는 `apps/mobile/ios/DiveWatchApp` 아래에 있다.
- `packages/contracts`: watch sync message의 JSON Schema 기준과 generated TypeScript/Swift output을 관리한다.
- `packages/supabase`: generated database type, typed client factory, onboarding parser와 provider-independent Auth repository를 관리한다.
- `packages/shared-utils`: 현재 source implementation이 없는 예약된 공유 workspace다.
- `supabase`: local Auth schema, migration/seed, database/REST tests와 isolated local CLI wrapper를 관리한다.

현재 코드에는 Wave 3A local Supabase/Auth foundation이 있다. Hosted provider/legal/signing과 physical Auth/re-consent는 승격 gate로 남고, remote Logbook/Planbook, cloud backup, principal sync, 계정 삭제와 paired-device background WatchConnectivity 검증은 구현되지 않았다.

모바일 로그북은 `DiveLogEntry`와 `DiveLogRepository` 경계를 사용한다. 현재는 로그인 없이 수동 로그를 만들고 watch fixture와 WatchConnectivity 수신 로그를 같은 목록에서 볼 수 있으며, 앱 기본 저장소는 AsyncStorage 기반 persistent repository다.

## 상세

watch 앱의 일반 기록 흐름은 `RealDepthSensorProvider`를 통해 `CMWaterSubmersionManager` 기반 depth/pressure sample을 받도록 구현됐다. Fake sample은 명시적 demo mode의 `DemoDepthSensorProvider`에서만 사용한다. 실제 underwater sensor behavior, auto-launch, Store/TestFlight 수준 Ultra-only filtering은 공개 배포 전 지원되는 Apple Watch Ultra hardware와 배포 채널에서 수동 검증이 필요하다.

모바일 앱은 generated TypeScript watch contract type과 로컬 watch fixture message를 import한다. 가져온 watch session은 raw `WatchSession`을 보존한 `DiveLogEntry`가 되며, 기본 구현에서는 AsyncStorage 기반 `PersistentDiveLogRepository`에 저장된다. Wave 3A login/consent는 이 guest 데이터를 변경하지 않으며 server 저장은 아직 없다.

모바일 설정은 테마 선호와 언어 선호를 AsyncStorage 기반 versioned JSON store에 저장한다. 테마는 `system`, `light`, `dark` 선호를 지원하고, 언어는 `ko`, `en`을 지원한다.

동기화 계약은 의도적으로 `userId`를 포함하지 않는다. Mobile Auth가 있어도 Watch payload와 현재 guest repository는 account principal에 연결되지 않는다. 사용자 data 연결은 3B/3C의 mobile/server 책임이다.

## 관련 문서

- [Monorepo 구조](../architecture/monorepo.md)
- [모바일 구조](../architecture/mobile.md)
- [모바일 로그북 로드맵](../architecture/mobile-logbook-roadmap.md)
- [Watch 앱 구조](../architecture/watch-app.md)
- [동기화 흐름 구조](../architecture/sync-flow.md)
- [안전 규칙](../domains/safety-rules.md)
