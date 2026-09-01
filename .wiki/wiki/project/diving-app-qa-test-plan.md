# Diving App / QA and Test Plan

Sources: pre-real-dive readiness scope and immediate hardening, 2026-07-12; Watch underwater runtime lifecycle implementation and device boundary, 2026-07-18; Watch Wet Ready and automatic local save, 2026-09-01
Raw: [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Watch underwater runtime lifecycle implementation and device boundary](../../raw/architecture/2026-07-18-watch-underwater-runtime-lifecycle.md); [Watch Wet Ready and automatic local save](../../raw/architecture/2026-09-01-watch-wet-ready-auto-save.md)
Updated: 2026-09-01

## 범위와 안전 경계

이 계획은 다이빙 기록, 사후 리뷰, 비중요 계획 reminder, Watch capture 동기화를 검증한다. 앱을 인증된 다이브 컴퓨터, 감압 컴퓨터, 의료기기, 생명 유지 장치 또는 비상 판단 시스템으로 검증하지 않는다.

감압 의무, 조직 loading, NDL, ceiling, gas switch 안전, MOD, CNS/OTU, gas remaining, TTS, no-fly medical 판단의 계산과 warning은 구현·시험·출시 범위가 아니다. Safety stop은 비인증 planning reminder와 사후 기록으로만 다룬다.

## Gate A: 자동 검증

- contract schema와 generated TypeScript/Swift 출력의 일치 여부를 검증한다.
- 모바일 typecheck, repository migration, Watch import serialization/dedupe, acknowledgement retry를 검증한다.
- Watch persistence, optional 수온 encoding, large payload fixture, Debug/Release compile을 검증한다.
- 1Hz bucket의 sparse/invalid/out-of-order/final flush, 3시간 10,800 sample 상한, immutable artifact digest와 legacy migration을 검증한다.
- short/large session이 모두 단일 `transferFile` 경로를 사용하고 ACK identity가 revision/digest까지 일치하는지 검증한다.
- fixture와 simulator 결과는 실제 WatchConnectivity delivery 또는 수중 sensor 동작의 증거로 쓰지 않는다.
- `RealDiveSessionCoordinatorTests`는 Wet Ready 뒤 runtime adoption과 runtime-first preferred-mode fallback, 2초 dry debounce, recording 뒤 mode lock, sample session의 automatic local save, 같은 local session ID save retry, system auto-launch no-sample non-save를 검증한다.

## Gate B: 건식 실기기

- 같은 build의 iPhone 앱과 embedded Watch 앱을 설치하고 paired/installed/reachable 상태를 기록한다.
- Test Scuba/Freedive의 foreground 자동 import, 수동 drain, 중복 delivery, 실패 후 재시도와 crash 부재를 확인한다.
- offline 저장 후 reconnect, iPhone background/killed delivery, 시작 시 durable inbox drain을 확인한다.
- 모바일 local save 뒤에만 acknowledgement가 발생하고 Watch session이 `synced`가 되는지 확인한다.
- planned scuba/freedive round trip과 source plan completion을 확인한다.
- Debug 8,000-sample fixture의 file transfer, 단일 import, dedupe와 acknowledgement를 확인한다.
- iOS 알림을 이전에 거부한 실기기에서 토글이 Settings 복구 경로를 열고 복귀 뒤 실제 권한과 preference가 일치하는지 확인한다.

Gate B는 Watch 앱이 설치되지 않은 동안 완료로 표시하지 않는다.

## Gate C: 얕은 물 센서

- signed watch bundle의 `underwater-depth`, code-signing entitlement, embedded provisioning profile의 shallow entitlement를 각각 확인한다. simulator와 unsigned build는 이 gate의 evidence가 아니다.
- capability 변경 뒤 reinstall하고 Settings > General > Auto-Launch > When Submerged에서 Divenary가 보이고 선택되는지, installed build/model/watchOS와 `requestAutoLaunchAuthorizationStatus`를 기록한다.
- 15cm bag/tank에서는 manually started real session의 약 `0.1 m` depth sample과 Water Lock만 확인한다. 이 결과는 `When Submerged` automatic launch pass가 아니다.
- Xcode Easy Submersion은 simulator system-session delivery/adoption과 UI navigation만 확인한다. physical sensor delivery, actual hardware `When Submerged` selection/auto-launch, Water Lock, device release readiness의 evidence가 아니다. physical automatic launch는 지원 hardware에서 shallow Wet Ready, active Water Lock, Crown mode selection, `handle(_:)` adoption과 recording mode lock으로 별도 확인한다.
- surface 뒤 Digital Crown Water Lock removal, surfaced `>=180s (3 minutes)` Action Button end, watchOS continuous out-of-water `>600s (10 minutes)` invalidation이 각각 기록 종료로 수렴하는지 확인한다. sample real completion은 touch 입력 없이 saved summary 하나가 나타나야 한다. Debug-only forced save failure에서는 `Saved` 조기 표시 없이 같은 local session ID로 automatic retry와 수동 Retry의 성공, 한 번의 recorder cleanup을 evidence로 남긴다. Action Button submerged/unknown/early rejection은 diver interaction이 아니라 existing unit test 또는 controlled developer harness로 확인한다.
- `600s (10 minutes)` 전에 resubmerge했을 때 같은 local session ID가 계속되는지, manual/Action Button no-sample은 compact result만 남기고 system auto-launch no-sample은 silent cancellation하는지 확인한다.
- D8 device evidence는 watchOS invalidation timing만 남긴다. app-side timer 부재는 `RealDiveSessionCoordinator.swift` timer-symbol static search와 `testWaterStateChangesDoNotStopOrReplaceRecording` unit test를 별도 감사 evidence로 보관한다.
- demo/debug는 Water Lock 없이 Crown depth simulation과 surface-gated touch end를 유지하고 `WKExtendedRuntimeSession`을 사용하지 않는지 확인한다.
- 42mm, 46mm, 49mm에서 recording helper/control row, depth rail, metric, disclaimer의 clipping/overlap을 screenshot으로 확인한다.
- 수온이 늦거나 없을 때 `0°C`를 저장·표시하지 않고, 수신 뒤 실제 측정값만 표시하는지 확인한다. 실제 프리다이빙·스쿠버 profile, 깊은 수심, 실제 safety-stop profile은 이 gate에서 제외한다. actual underwater behavior는 지원 hardware evidence 전까지 pending이다.

## Gate D: Cloud와 제품 흐름

- Supabase Auth session lifecycle, RLS owner isolation, migration과 generated database type을 검증한다.
- offline outbox, reconnect retry, idempotency, conflict policy, account 전환과 삭제를 검증한다.
- media Storage ownership, signed URL, upload retry와 orphan cleanup을 검증한다.
- Memory/share의 metadata redaction, 권한, 취소·실패·재시도와 export 정확성을 검증한다.
- 검색, filter, 통계, review, notification route, privacy control의 반복 사용 흐름을 검증한다.

## Gate E: 출시 준비

- Debug control과 test capture가 Release UI와 production data에서 분리되는지 검증한다.
- privacy manifest, permission copy, accessibility, localization, retention/deletion과 observability를 검증한다.
- 모든 user-facing copy가 기록·사후 리뷰·비중요 reminder 범위를 유지하는지 확인한다.

## 실제 다이빙 전용 Gate

실제 프리다이빙·스쿠버, 깊은 수심, 장시간 submerged/background behavior는 별도 최종 gate다. Gate A-E가 끝나도 이 결과를 추정하거나 통과로 표시하지 않는다.

## 회귀 정책

- contract 또는 저장 schema가 바뀌면 backward fixture와 migration을 함께 검증한다.
- Watch import 순서나 acknowledgement가 바뀌면 reconnect, duplicate, failure-redelivery case를 다시 실행한다.
- sensor field가 optional로 바뀌면 missing/late/partial sample을 JSON, persistence, summary, mobile UI에서 검증한다.
- Debug 도구가 추가되면 Debug와 Release build를 모두 검증한다.
- 물리 gate는 기기, OS, build id, 연결 상태, payload evidence와 crash log를 함께 기록한다.
- underwater runtime 물리 gate는 시작 원인, `requestAutoLaunchAuthorizationStatus`, local session ID, sample 수, summary 수, Water Lock/Action Button evidence를 함께 기록한다.

## 관련 문서

- [구현 우선순위 기록](../architecture/implementation-priorities.md)
- [WatchConnectivity 실기기 체크리스트](../../../docs/2026-06-26-pre-device-priorities/watchconnectivity-real-device-checklist.md)
- [Watch underwater runtime 실기기 체크리스트](../../../docs/2026-07-18-watch-underwater-runtime-device-checklist.md)
- [Diving App / Non-Negotiable Safety Rules](../domains/diving-app-non-negotiable-safety-rules.md)
