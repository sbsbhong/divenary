# ADR: 개인정보 최소화 device-local 진단 파이프라인

Sources: 사용자 승인 진단 설계, 2026-08-02
Raw: [개인정보 최소화 모바일·Watch 진단 결정](../../raw/decisions/2026-08-02-privacy-minimized-diagnostics.md)
Updated: 2026-08-02

## Status

Accepted design; not implemented

## Context

React Native 실기기와 Apple Watch에서 개발 console이 연결되지 않은 동안 발생한 오류는
현재 `console`, 일부 `OSLog`와 `assertionFailure`만으로 사건 순서를 복구하기 어렵다.
Field tester가 나중에 기억한 증상만 전달하는 방식은 background lifecycle,
WatchConnectivity와 local-first/account sync가 겹친 문제를 재현하기에 부족하다.

Debug build에 다이빙 원본을 남기는 안도 검토했지만, debug log 역시 Mac Console, 공유
파일과 backup을 통해 유출될 수 있어 build별 개인정보 정책을 두지 않기로 했다.

## Decision

앱이 공통 JSON Schema와 `DiagnosticEvent`를 소유한다. Mobile과 Watch는 각각 bounded
순환 journal에 event를 저장하고, Watch event는 별도 WatchConnectivity queue와 ACK로
iPhone에 자동 복사한다. 이 ACK는 Watch session import, mobile local save, account cloud
sync 또는 guest claim 완료를 뜻하지 않는다.

Event는 enum 기반 이름과 오류 코드, boolean, count, duration, retry와 connectivity
state처럼 schema가 허용한 scalar만 포함한다. 계정·기기 영구 식별자, Auth 정보, 위치,
메모, 미디어, 계획, 다이빙 수치·sample, session/sync payload와 임의 문자열 metadata는
모든 build에서 금지한다. Timestamp와 일반 device model도 완전한 익명 데이터라고
표현하지 않고 최소화된 진단 metadata로 다룬다.

Watch retention은 3일 또는 1MB, iPhone retention은 14일 또는 10MB다. 사용자는 Settings의
진단 화면에서 고정 분류 incident marker를 남기고, 포함 기간·event 수·크기·기기 정보
범주를 확인한 뒤 단일 JSONL을 수동 공유하거나 전체 로그 삭제를 요청할 수 있다.
Incident 분석 구간은 marker 전 10분과 후 5분이다.

1단계는 공통 contract, local journal, 핵심 mobile/watch 계측, Watch 자동 복사, marker,
export와 cross-device purge다. 2단계 remote sink는 provider 선정, 명시적 동의와 opt-out,
privacy policy, sampling, retention/deletion, native crash와 symbolication을 별도 승인한 뒤
추가한다. 현재 어떤 원격 provider도 선택하거나 자동 upload하지 않는다.

## Consequences

개발자와 Codex는 사용자가 내보낸 timeline을 바탕으로 field issue를 분석할 수 있고,
Watch의 offline event도 연결 뒤 iPhone에서 함께 볼 수 있다. 반면 원본 dive profile이나
자유 입력이 없으므로 데이터 값 자체의 오류는 별도로 선택·제공된 재현 자료 없이는
분석하지 못할 수 있다.

진단 기록은 best effort다. Journal 또는 transport 실패가 recording, session save,
Watch import ACK, account sync와 claim 결과를 바꾸지 않는다. App-owned journal은 native
crash를 완전하게 포착하지 못하므로 `previous_run_unfinished`를 crash 확정으로 해석하지
않으며 native crash reporting은 2단계로 남는다.

구현 완료 전에는 이 ADR을 기능 제공 증거로 사용하지 않는다. 구현 뒤에도 paired-device
background transfer, reconnect, ACK retry, retention과 offline purge를 별도로 검증해야
한다.

## Sources

- `docs/superpowers/specs/2026-08-02-privacy-minimized-diagnostics-design.md`
- `apps/mobile/src/components/app-error-boundary.tsx`
- `apps/mobile/src/states/watch-connectivity-sync.tsx`
- `apps/mobile/ios/Divenary/WatchConnectivityInbox.swift`
- `apps/mobile/ios/DivenaryWatchApp/Runtime/DiveActionButtonIntents.swift`

## 관련 문서

- [ADR 목록](adr-index.md)
- [구현 우선순위 기록](../architecture/implementation-priorities.md)
- [동기화 흐름 구조](../architecture/sync-flow.md)
- [열린 질문](../questions/open-questions.md)
