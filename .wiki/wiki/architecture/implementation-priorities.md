# 구현 우선순위 기록

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Wave 3 Supabase/Auth 승인 결정, 2026-07-13; Wave 3A Auth 설계 검토 보정, 2026-07-13; Wave 3A Supabase Auth foundation 구현 증거, 2026-07-15; Divenary Auth promotion readiness evidence, 2026-07-15; Google iOS client and callback correction, 2026-07-16; Guest data account claim implementation evidence, 2026-07-20
Raw: [Pre-Karpathy: 구현 우선순위 기록](../../raw/architecture/implementation-priorities.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Wave 3 Supabase/Auth 승인 결정](../../raw/architecture/2026-07-13-wave3-supabase-auth-decisions.md); [Wave 3A Auth 설계 검토 보정](../../raw/architecture/2026-07-13-wave3-auth-design-review.md); [Wave 3A Supabase Auth foundation 구현 증거](../../raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md); [Divenary Auth promotion readiness evidence](../../raw/architecture/2026-07-15-divenary-auth-promotion-readiness.md); [Google iOS client and callback correction](../../raw/architecture/2026-07-16-google-ios-callback-correction.md); [Guest data account claim implementation evidence](../../raw/architecture/2026-07-19-guest-data-account-claim-implementation.md)
Updated: 2026-07-20

## 요약

실제 프리다이빙·스쿠버를 해야만 검증할 수 있는 항목을 제외한 모든 미구현 작업은 P0다. Auth, owner account schema, principal partition, outbox/sync와 guest claim core의 코드·자동 검증은 구현됐다. 현재 우선순위는 hosted staging 배포, Google/claim 실기기 검증, post-Auth Watch regression, committed claim evidence lifecycle과 account deletion gate다.

## 현재 상태

즉시 hardening과 Wave 3 account-data/claim core의 코드 구현·자동 검증은 완료됐다. 사용자는 physical iPhone Apple login과 Auth 도입 전 약 4분 Watch foreground import/local ACK 기준선을 확인했다. Google login, hosted account-data/claim deployment, physical claim, post-Auth Watch regression, reconnect, background, killed-app과 large transfer는 완료 증거가 아니다. 남은 Wave 1/2 항목도 삭제하지 않는다.

- 자동 event와 수동 drain은 process-wide `WatchConnectivityImportCoordinator`를 공유한다. 같은 `payloadId`는 합쳐지고 서로 다른 payload는 직렬 처리되며 실패 뒤에도 queue가 계속된다.
- Watch 수온은 optional이다. 첫 수온 update 전 값을 `0°C`로 만들지 않고, 수온이 없는 sample도 깊이·압력 기록으로 보존한다.
- 모바일 `DiveLogEntry.cloudSyncStatus`와 raw Watch `session.syncStatus`를 분리했다. Logbook schema 2의 모든 기존 모바일 상태는 schema 3에서 `notConfigured`로 migration한다. Cloud backend가 없을 때는 cloud filter와 status pill을 표시하지 않는다.
- `DivenaryWatchAppDebug`에서 deterministic 8,000-sample `Test Large Sync`를 일반 저장·전송 경로로 실행할 수 있다.

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

- 3A automated: root `supabase/`, `packages/supabase`, generated type, Keychain-compatible session, iOS native Google/Apple Auth, immutable legal version/current pointer 기반 mandatory consent가 구현됐다. Apple physical login은 사용자 확인을 받았지만 Google physical login, re-consent와 post-Auth Watch regression은 pending이다.
- 3B code/automated: user-owned Logbook/Planbook schema와 owner RLS, keyset cursor, private immutable 1Hz profile Storage와 typed repository가 구현됐다. Hosted staging account-data migration과 physical account sync는 pending이다.
- 3C core/automated: `guest`/`user:<uuid>` local partition, durable account outbox/revision conflict, immutable manifest와 bounded batch를 쓰는 explicit guest claim이 구현됐다. Claim UI integration, hosted Edge Function, physical retry/resume/cleanup/isolation과 committed claim evidence lifecycle은 pending이다.
- 3D: logout 때 account local cache/profile을 기기에서 제거하고 guest를 보존한다. 앱 안에서 즉시 영구 계정 삭제와 통합 회귀를 검증한다.
- Email/password, magic link, SMS, Android native Auth, profile/nickname/friends, app-provided manual identity management, marketing consent는 Wave 3 범위 밖이다. 같은 verified email은 Supabase Auth automatic linking을 따른다.
- 코드 구현과 hosted/physical 승격 gate를 분리한다. Production Supabase, production legal documents, post-commit claim evidence lifecycle과 3D 앱 내 계정 삭제 전에는 release하지 않는다.
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
