# Agent Operating Guide

이 파일은 `diving-app` 저장소 전체에 적용된다. 하위 디렉터리에 별도 `AGENTS.md`가 있으면, 그 파일의 지침도 함께 적용한다.

## 프로젝트 개요

`diving-app`은 레크리에이션 다이빙 로그와 워치 기반 세션 기록을 위한 companion app 모노레포다. 현재 저장소의 목표는 완성된 상용 앱이 아니라, React Native 모바일 앱, SwiftUI watchOS 앱, 공유 sync contract를 한 저장소에서 안전하게 발전시키는 기반을 만드는 것이다.

이 앱은 인증된 다이브 컴퓨터, 감압 컴퓨터, 의료기기, 생명 유지 장치, 비상 판단 시스템이 아니다. 제품과 문서는 다이빙 기록, 사후 리뷰, 비중요 계획 리마인더, 워치 캡처 데이터 동기화라는 범위 안에서 설명해야 한다.

## 현재 목표

- Apple Watch에서 다이빙 세션을 가볍게 기록하고 로컬에서 확인할 수 있는 watchOS 앱 PoC를 유지한다.
- 모바일 앱에서 워치에서 온 세션을 리뷰하고, 로그북/계획/메모리 화면을 확장할 기반을 만든다.
- `packages/contracts`의 JSON Schema를 watch-mobile sync contract의 기준으로 유지한다.
- 구현된 Supabase/Auth foundation과 account Logbook/Planbook schema, principal-partitioned local repository, account outbox/sync, explicit guest claim 경계를 유지한다. Account-data migrations와 claim Edge Function은 staging `mclvhwzsuvsxjerdouka`에 배포됐고 automated staging verifier를 통과했다. Physical claim과 production 승격은 별도 gate다.
- WatchConnectivity import acknowledgement는 모바일 local repository 저장만 뜻하며 account cloud sync나 guest claim 완료와 섞지 않는다.
- 안전-critical 기능으로 오해될 수 있는 감압, 조직 포화도, 가스 전환 안전, 비상 지시 기능은 구현하거나 암시하지 않는다.

## 저장소 구조

- 루트: Yarn 1 workspaces와 Turborepo를 사용한다. `packageManager`는 `yarn@1.22.22`다. npm, pnpm, bun으로 lockfile을 갱신하지 않는다.
- 이 저장소는 모노레포다. `apps/` 아래 workspace 변경도 루트 저장소 기준으로 추적한다.
- `apps/mobile`: Bare React Native 모바일 앱 workspace. React Native `0.85.3`을 사용한다. iOS native project는 `apps/mobile/ios/Divenary.xcodeproj`이며, iPhone app target `Divenary`과 companion watchOS target `DivenaryWatchApp`를 함께 소유한다. Watch source는 `apps/mobile/ios/DivenaryWatchApp` 아래에 둔다. 앱별 상세 지침은 `apps/mobile/AGENTS.md`를 따른다.
- `packages/contracts`: watch sync contract의 JSON Schema 원본과 generated TypeScript/Swift 출력물을 관리한다.
- `packages/supabase`: generated database type, typed client factory, onboarding parser, provider-independent Auth repository와 typed account Logbook/Planbook/profile/guest claim repository를 관리한다. React Native UI나 native provider SDK를 넣지 않는다.
- `packages/shared-utils`: 예약된 공유 package다. 실제 source 구현은 아직 없다.
- `supabase`: local configuration, Auth/account-data migration과 seed, owner RLS, private profile Storage, guest claim finalizer/Edge Function, pgTAP/REST harness와 hosted 환경에서 격리된 CLI wrapper를 관리한다. Account-data migrations와 claim Edge Function은 staging에 배포됐으며 production과는 분리한다.
- `.wiki/`: Karpathy LLM Wiki 방식의 장기 프로젝트 지식 저장소다. `.wiki/raw/`는 원본 source material, `.wiki/wiki/`는 compiled knowledge article이며, `.wiki/wiki/index.md`와 `.wiki/wiki/log.md`를 기준으로 탐색한다.

## 앱 요약

### `apps/mobile`

모바일 앱은 React Native 기반의 다이빙 로그 리뷰 surface이자 iPhone/watch companion bundle의 소유자다. 현재는 React Navigation 기반 bottom-tab navigation, principal-partitioned AsyncStorage Logbook/Planbook, 수동 로그 작성, 계획 알림, iOS WatchConnectivity receiver/import acknowledgement PoC, mobile-to-watch planned dive 전달 PoC, Settings 기기 관리와 companion watch target embed 구조를 갖는다. 또한 Keychain-compatible session, iOS native Google/Apple credential adapter, Auth state/UI, versioned mandatory consent, account local-first outbox/sync와 resumable guest claim service를 갖는다. Account-data/claim은 hosted staging automated verifier를 통과했고 Apple physical login은 사용자 확인을 거쳤지만 Google physical login, physical claim, production cloud와 account deletion은 아직 검증되지 않았다.

모바일 앱은 인증, 로그북, 수동 로그 작성, 사용자 프로필/Supabase data sync, 통계/검색/리뷰/공유 흐름의 중심이다. Guest Logbook/Planbook은 로그인만으로 삭제하지 않고 사용자가 claim 또는 기기에 유지를 선택한다. Claim은 immutable snapshot과 원격 commit/readback, account local publication/readback 뒤 exact snapshot만 정리하며, claim 중 변경된 guest row는 account local-first/outbox로 승격한 뒤 삭제한다. 직접 SQL, 중복 Supabase schema type, watch-only sensor capture logic, imported watch sample을 손실시키는 raw rewrite는 넣지 않는다.

### watchOS companion

watchOS 앱은 SwiftUI 기반 Apple Watch recording surface다. 현재 active source는 `apps/mobile/ios/DivenaryWatchApp`이며, `apps/mobile/ios/Divenary.xcodeproj`의 `DivenaryWatchApp` target/scheme으로 빌드된다. 별도 watch workspace는 유지하지 않는다.

watch 앱은 pre-dive metadata capture, 모바일 planned dive 시작, `CMWaterSubmersionManager` 기반 real provider와 명시적 demo provider를 통한 live recording, local persistence, summary, saved session list/detail, sync-ready JSON export의 책임을 갖는다. 실제 underwater sensor behavior는 아직 지원 hardware에서 검증해야 한다. 복잡한 account 관리, 전체 로그북 관리, Supabase schema-specific business logic, Auth entitlement와 provider callback은 watch 앱에 넣지 않는다.

## Skill 사용 방식

- 작업을 시작할 때 현재 세션에 제공된 skill 목록을 확인하고, 설명이나 trigger가 1%라도 맞는 skill은 먼저 읽은 뒤 따른다.
- 새 기능 설계나 동작 변경처럼 비단순 작업에는 Superpowers workflow를 사용한다. 단, 사용자 지시와 이 저장소의 `AGENTS.md`가 더 구체적이면 그 지시를 우선한다.
- `.wiki/`를 만들거나 수정하거나, architecture, app boundary, sync behavior, domain model, safety rule, Supabase/auth 의미가 바뀌면 먼저 `.agents/skills/karpathy-llm-wiki`를 따르고, 이 저장소의 한국어 작성 스타일과 안전 경계 보강 규칙은 `.agents/skills/wiki-writing`에서 확인한다.
- React Native 작업에는 `vercel-react-native-skills`를 우선 검토하고, React/Next 스타일의 component architecture나 성능 판단이 필요하면 관련 Vercel React skill을 추가로 사용한다.
- watchOS, iOS native, Xcode project, scheme, entitlement, signing, native module 변경에는 `xcode-harness`를 사용한다.
- Supabase, auth, RLS, migration, generated database type, repository 작업에는 `supabase` skill을 사용한다.
- GitHub PR/CI 작업은 사용자가 GitHub 작업을 요청할 때만 GitHub plugin skill을 사용한다.
- OpenSpec은 사용자가 명시적으로 요청하지 않으면 사용하지 않는다.

## Agent Workflow

- 요구사항, 위험, 대안을 먼저 확인한 뒤 새 기능 설계를 확정한다.
- 비단순 변경은 편집 전에 간단한 구현 계획을 세운다.
- 기존 package script, workspace layout, native project 상태를 먼저 확인한다.
- 변경은 요청된 surface에 한정한다. 인프라 준비 중 feature work를 끼워 넣지 않는다.
- 의존성은 명시적으로 필요하고 기존 패턴으로 해결할 수 없을 때만 추가한다.
- generated contract output은 직접 수정하지 않는다. schema나 generator를 수정한 뒤 generation을 실행한다.
- `.git` metadata를 사용할 수 없으면 `git status`나 diff에 의존하지 말고, 직접 확인한 수정 파일을 최종 보고한다.
- sandboxed run에서 Yarn cache/global-folder warning이나 Xcode CoreSimulator log permission warning이 나올 수 있다. command가 성공하면 환경 warning으로 취급한다.
- 같은 verification gate가 같은 원인으로 세 번 실패하면 멈추고 command, error summary, 시도한 수정, 필요한 수동 조치를 보고한다.

## Coding Style

- TypeScript/JavaScript는 기존 ESM script 스타일을 따른다.
- Node script는 작고 결정적이며 의존성이 적어야 한다.
- Swift code는 `apps/mobile/ios/DivenaryWatchApp`의 기존 SwiftUI 구조를 따른다.
- 실제 call site가 둘 이상 생기기 전에는 speculative shared utility를 만들지 않는다.
- 명확한 이름과 작은 type을 선호하고, 넓은 abstraction은 피한다.

## Safety Boundary

앱은 다음을 해서는 안 된다.

- 감압 의무, 조직 loading, 가스 전환 안전, 비상 다이빙 결정을 계산한다.
- 생명-critical underwater instruction을 제공한다.
- 인증된 다이브 장비를 대체한다고 설명한다.
- 검증되지 않은 sensor data를 safety-critical truth로 표시한다.
- certified dive computer, medical, legal, emergency recommendation claim을 한다.

앱은 다음을 할 수 있다.

- 다이빙 로그를 기록한다.
- 과거 다이빙 summary를 보여준다.
- 사용자가 다이빙에 annotation을 남기도록 돕는다.
- watch-captured activity data를 sync한다.
- 비중요 reminder와 post-dive summary를 제공한다.

ascent, safety stop, no-fly, underwater warning을 언급하는 watch/mobile surface는 반드시 non-certified assistant 또는 planning reminder로 설명한다. 실제 Apple Watch underwater sensor behavior는 public release 전에 지원 hardware에서 수동 검증해야 한다.

## Verification Commands

가장 작은 관련 gate부터 실행하고, 필요하면 넓힌다.

- Contract/schema/generator 변경: `yarn check:quick`
- watchOS, Swift, Xcode project, scheme, entitlement, native 변경: `yarn watch:build`
- agentic, contract, watchOS, wiki, architecture-rule 변경 후 일반 handoff: `yarn codex:check`
- React Native/iOS mobile 변경: `yarn mobile:typecheck` 먼저 실행한 뒤, CocoaPods workspace가 준비되어 있으면 `yarn ios:build`
- Supabase 변경: local Supabase script를 먼저 확인한 뒤 가능한 가장 작은 migration/type-generation/repository gate 실행

현재 환경에서 실제로 실행하지 않은 command를 pass했다고 보고하지 않는다.
