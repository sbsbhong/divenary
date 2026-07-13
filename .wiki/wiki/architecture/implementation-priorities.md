# 구현 우선순위 기록

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Wave 3 Supabase/Auth 승인 결정, 2026-07-13
Raw: [Pre-Karpathy: 구현 우선순위 기록](../../raw/architecture/implementation-priorities.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Wave 3 Supabase/Auth 승인 결정](../../raw/architecture/2026-07-13-wave3-supabase-auth-decisions.md)
Updated: 2026-07-13

## 요약

실제 프리다이빙·스쿠버를 해야만 검증할 수 있는 항목을 제외한 모든 미구현 작업은 P0다. 사용자가 foreground pairing/import/local acknowledgement 기준선을 확인했으므로 현재 구현 순서는 Wave 3 Supabase/Auth로 이동한다. Wave 1의 나머지 물리 항목과 Wave 2는 Wave 3 이후 통합 환경에서 다시 검증한다.

## 현재 상태

즉시 hardening의 코드 구현과 자동 검증은 완료됐다. 사용자는 실기기에서 약 4분의 foreground pairing, Watch session 자동 import, 모바일 local save 뒤 Watch `synced` 전환을 확인했다. 이 보고는 핵심 foreground 경로의 기준선이며 build identifier, 기기/OS, reconnect, background, killed-app, large transfer 완료 증거는 아니다. 현재 활성 구현은 Wave 3이고 남은 Wave 1/2 항목은 삭제하지 않는다.

- 자동 event와 수동 drain은 process-wide `WatchConnectivityImportCoordinator`를 공유한다. 같은 `payloadId`는 합쳐지고 서로 다른 payload는 직렬 처리되며 실패 뒤에도 queue가 계속된다.
- Watch 수온은 optional이다. 첫 수온 update 전 값을 `0°C`로 만들지 않고, 수온이 없는 sample도 깊이·압력 기록으로 보존한다.
- 모바일 `DiveLogEntry.cloudSyncStatus`와 raw Watch `session.syncStatus`를 분리했다. Logbook schema 2의 모든 기존 모바일 상태는 schema 3에서 `notConfigured`로 migration한다. Cloud backend가 없을 때는 cloud filter와 status pill을 표시하지 않는다.
- `DiveWatchAppDebug`에서 deterministic 8,000-sample `Test Large Sync`를 일반 저장·전송 경로로 실행할 수 있다.

자동 검증과 foreground 핵심 실기기 경로는 확인됐지만 reconnect crash 부재, background delivery, killed-app recovery, large file transfer는 완료로 판정하지 않는다. Simulator나 mock 결과를 실기기 또는 수중 동작의 증거로 쓰지 않는다.

## P0 Wave 1: 건식 실기기

- 같은 build의 iPhone 앱과 embedded Watch 앱 설치, pairing/installed/reachable 상태 확인.
- Test Scuba/Freedive foreground 자동 import와 수동 drain fallback.
- 연결 해제 상태 저장 후 재연결, 자동 import와 수동 drain 동시 실행, 중복 delivery, 실패 뒤 재시도, crash 부재 확인.
- 모바일 local repository 저장 뒤 Watch acknowledgement와 Watch `synced` 상태 확인.
- iPhone background와 killed 상태 delivery, 시작 시 durable inbox drain, notification opt-in/permission/press routing 확인.
- 모바일 planned scuba/freedive의 Watch 전달, 선택·저장·모바일 plan completion round trip 확인.
- `Test Large Sync`의 file transfer, 모바일 import, dedupe, acknowledgement 확인.

## P0 Wave 2: 얕은 물 센서

- 얕은 물통 또는 수영장에서 real `CMWaterSubmersionManager` depth와 pressure sample 확인.
- 수온 update가 늦거나 없을 때 `0°C`가 저장·표시되지 않고, 수신 뒤 실제 측정값만 나타나는지 확인.
- 3m auto-start는 충분한 수심의 안전한 통제 환경에서만 확인하고, 자동 시작을 certified 판단으로 설명하지 않는다.
- background handoff, auto-launch authorization/prompt, haptic, 젖은 화면과 crown 조작, 가독성을 기록한다.
- 실제 프리다이빙·스쿠버 profile, 깊은 수심, 실제 safety-stop profile은 이 wave에서 제외한다.

## P0 Wave 3: Supabase와 인증

- 3A: root `supabase/`, `packages/supabase`, generated type, Keychain session, iOS native Google/Apple Auth, mandatory versioned terms/privacy consent를 만든다. Logbook/Planbook은 이 단계에서 local-only다.
- 3B: user-owned Logbook/Planbook schema와 RLS, keyset cursor infinite pagination, private immutable 1Hz profile Storage와 detail-only fetch를 만든다.
- 3C: `guest`/`user:<uuid>` local partition, explicit guest claim, idempotent outbox, retry/backoff, revision conflict와 `cloudSyncStatus` 전이를 활성화한다.
- 3D: logout 때 account local cache/profile을 기기에서 제거하고 guest를 보존한다. 앱 안에서 즉시 영구 계정 삭제와 통합 회귀를 검증한다.
- Email/password, magic link, SMS, Android native Auth, profile/nickname/friends, app-provided manual identity management, marketing consent는 Wave 3 범위 밖이다. 같은 verified email은 Supabase Auth automatic linking을 따른다.
- 7일 유예 soft deletion/recovery는 즉시 영구 삭제 뒤의 명시적 후속 기능이다.

## P0 Wave 4: 제품 완성

- Memory/share를 별도 spec으로 재설계하고 현재 tab 구조에 연결한다.
- 사진·영상 첨부, export/share card, metadata redaction, 실패/취소 상태를 구현한다.
- Logbook profile·검색·filter·통계·review와 Planbook 반복 사용 흐름을 실제 저장소 기준으로 마무리한다.
- Watch sync retry/status, account/cloud 상태, storage/privacy control을 Settings에 추가한다.
- 접근성, 동적 글자 크기, 한국어/영어 문구, 빈 상태, 오류·offline 상태를 전체 흐름에서 검증한다.

## P0 Wave 5: 출시와 안전 경계

- App Store/TestFlight의 지원 Watch filtering, signing, entitlement, privacy manifest, 권한 문구, 데이터 삭제를 검증한다.
- 전체 migration, RLS/security, background delivery, crash recovery, export/privacy QA를 실행한다.
- 외부 dive-computer import 또는 decompression stop 표시는 source provenance와 read-only 사실 보존 범위부터 별도 고위험 spec으로 설계한다.
- 감압 의무, 조직 loading, gas switching safety, 비상 판단, 상승 허가 계산은 구현하지 않는다.

## 실제 잠수 게이트

다음 항목은 P0 pre-real-dive backlog와 분리한다.

- 실제 프리다이빙·스쿠버 세션 전체 기록.
- 깊은 수심과 40m 경계에서의 실제 sensor behavior.
- 실제 scuba profile에서 safety-stop reminder 안정성.
- 장시간 반복 잠수, 실사용 배터리, 수중 장시간 background behavior.

## 관련 문서

- [동기화 흐름 구조](sync-flow.md)
- [모바일 구조](mobile.md)
- [Watch 앱 구조](watch-app.md)
- [Supabase 구조](supabase.md)
- [안전 규칙](../domains/safety-rules.md)
- [열린 질문](../questions/open-questions.md)
