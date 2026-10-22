# 구현 우선순위 기록

Sources: pre-Karpathy wiki page, 2026-06-28; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Wave 3 Supabase/Auth 승인 결정, 2026-07-13; Wave 3A Auth 설계 검토 보정, 2026-07-13; Wave 3A Supabase Auth foundation 구현 증거, 2026-07-15; Divenary Auth promotion readiness evidence, 2026-07-15; Google iOS client and callback correction, 2026-07-16; Guest data account claim implementation evidence, 2026-07-20; Guest data account claim staging promotion evidence, 2026-07-20; 사용자 승인 진단 설계, 2026-08-02; 워치 UX 리뷰 3종 및 소유자 백로그 승인, 2026-10-22
Raw: [Pre-Karpathy: 구현 우선순위 기록](../../raw/architecture/implementation-priorities.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Wave 3 Supabase/Auth 승인 결정](../../raw/architecture/2026-07-13-wave3-supabase-auth-decisions.md); [Wave 3A Auth 설계 검토 보정](../../raw/architecture/2026-07-13-wave3-auth-design-review.md); [Wave 3A Supabase Auth foundation 구현 증거](../../raw/architecture/2026-07-15-wave3a-auth-foundation-implementation.md); [Divenary Auth promotion readiness evidence](../../raw/architecture/2026-07-15-divenary-auth-promotion-readiness.md); [Google iOS client and callback correction](../../raw/architecture/2026-07-16-google-ios-callback-correction.md); [Guest data account claim implementation evidence](../../raw/architecture/2026-07-19-guest-data-account-claim-implementation.md); [Guest data account claim staging promotion evidence](../../raw/architecture/2026-07-20-guest-data-account-claim-staging-promotion.md); [개인정보 최소화 모바일·Watch 진단 결정](../../raw/decisions/2026-08-02-privacy-minimized-diagnostics.md); [2026-10-22 워치 UX 리뷰와 소유자 백로그 승인](../../raw/design/2026-10-22-watch-ux-review.md)
Updated: 2026-10-22

## 요약

실제 프리다이빙·스쿠버를 해야만 검증할 수 있는 항목을 제외한 모든 미구현 작업은 P0다. Auth, owner account schema, principal partition, outbox/sync, guest claim core와 hosted staging automated verification은 완료됐다. 현재 우선순위는 Google/claim 실기기 검증, post-Auth Watch regression, committed claim evidence lifecycle, account deletion과 개인정보 최소화 진단 기반이다.

## 현재 상태

즉시 hardening, Wave 3 account-data/claim core의 코드 구현·자동 검증과 hosted staging deployment/verifier는 완료됐다. 사용자는 physical iPhone Apple login과 Auth 도입 전 약 4분 Watch foreground import/local ACK 기준선을 확인했다. Google login, physical claim, post-Auth Watch regression, reconnect, background, killed-app과 large transfer는 완료 증거가 아니다. 남은 Wave 1/2 항목도 삭제하지 않는다.

- 자동 event와 수동 drain은 process-wide `WatchConnectivityImportCoordinator`를 공유한다. 같은 `payloadId`는 합쳐지고 서로 다른 payload는 직렬 처리되며 실패 뒤에도 queue가 계속된다.
- Watch 수온은 optional이다. 첫 수온 update 전 값을 `0°C`로 만들지 않고, 수온이 없는 sample도 깊이·압력 기록으로 보존한다.
- 모바일 `DiveLogEntry.cloudSyncStatus`와 raw Watch `session.syncStatus`를 분리했다. Logbook schema 2의 모든 기존 모바일 상태는 schema 3에서 `notConfigured`로 migration한다. Cloud backend가 없을 때는 cloud filter와 status pill을 표시하지 않는다.
- `DivenaryWatchAppDebug`에서 deterministic 8,000-sample `Test Large Sync`를 일반 저장·전송 경로로 실행할 수 있다.

자동 검증과 foreground 핵심 실기기 경로는 확인됐지만 reconnect crash 부재, background delivery, killed-app recovery, large file transfer는 완료로 판정하지 않는다. Simulator나 mock 결과를 실기기 또는 수중 동작의 증거로 쓰지 않는다.

## 2026-10-22 승인된 워치 UX 백로그

소유자는 A(기록 정확성)·B(막힌 흐름)를 현재 수정 중이라고 알리고 D·E의 백로그 등록을 승인했다. A·B의 완료나 실기기 통과를 뜻하지 않는다. D는 사실 기록 기능, E는 [소유자 결정 대기](../questions/open-questions.md)의 목록이다. 경쟁 사례와 누락 판단은 [리뷰 원자료](../../raw/design/2026-10-22-watch-ux-review.md)의 benchmark·inventory·docs-gap 보고서를 근거로 한다.

기존 P0 모델대로 D6의 센서 범위·표시 검증은 Wave 2, D1–D5의 제품 기능·접근성은 Wave 4에 둔다. Wave는 의존 관계이며 낮은 우선순위를 뜻하지 않는다. `지금 구현 가능`은 승인된 기록 기능의 구현 착수 가능, `결정 필요`는 입력·정책·계약 선택 대기, `하드웨어 필요`는 실제 기기에서만 닫을 수 있는 검증을 뜻한다. 모두 백로그이며 구현 완료 표시는 아니다. 판단이 필요한 안전 경계는 Wave 5에서 검토하고, 실제 깊은 잠수 검증은 별도 실제 잠수 게이트에 남긴다.

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

### D6: 수심 측정 범위 밖 기록 화면

- **무엇·효용:** 수심이 제공되지 않아도 전체 기록 시간과 기록 상태를 읽고, `수심 측정 범위 밖`을 이해할 수 있는 화면을 설계한다. 현재 공개 shallow 접근은 약 6 m여서 스쿠버 대부분의 수심이 범위 밖일 수 있다. 기존 범위 밖 표시는 있으므로 새 센서 탐지 기능이 아니라 이 상태를 중심으로 한 화면 설계 백로그다.
- **경쟁 근거:** benchmark A12의 [Apple Depth 범위 초과 표시](https://support.apple.com/en-au/102273), A13의 [Apple Core Motion 설명](https://developer.apple.com/videos/play/wwdc2023/10179/), A14의 [센서 접근 문서](https://developer.apple.com/documentation/coremotion/accessing-submersion-data). Depth의 노란 경보 화면 자체를 복제하지 않는다.
- **안전 확인:** 센서 허가 범위와 제품의 40 m 지원 상한을 구분한다. 없는 수심을 0·마지막 값·압력 외삽으로 채우지 않고, 상승·하강 지시나 안전 수심 판정을 하지 않는다. 이 앱은 인증된 다이브 컴퓨터가 아니다.
- **상태:** 화면 설계와 결측 상태 구현은 **지금 구현 가능**. 실제 범위 초과·오류·복귀 동작은 **하드웨어 필요**이며 깊은 접근은 Apple managed entitlement·provisioning 승인도 필요하다. 얕은 물 검증이나 모의 상태로 깊은 수중 동작을 통과 처리하지 않는다.

## P0 Wave 3: Supabase와 인증

- 3A automated: root `supabase/`, `packages/supabase`, generated type, Keychain-compatible session, iOS native Google/Apple Auth, immutable legal version/current pointer 기반 mandatory consent가 구현됐다. Apple physical login은 사용자 확인을 받았지만 Google physical login, re-consent와 post-Auth Watch regression은 pending이다.
- 3B hosted/automated: user-owned Logbook/Planbook schema와 owner RLS, keyset cursor, private immutable 1Hz profile Storage와 typed repository를 staging에 배포하고 verifier로 검증했다. Physical account sync는 pending이다.
- 3C hosted/automated: `guest`/`user:<uuid>` local partition, durable account outbox/revision conflict, immutable manifest와 bounded batch를 쓰는 explicit guest claim, claim UI와 hosted Edge Function verifier를 통합했다. Physical retry/resume/cleanup/isolation과 committed claim evidence lifecycle은 pending이다.
- 3D: logout 때 account local cache/profile을 기기에서 제거하고 guest를 보존한다. 앱 안에서 즉시 영구 계정 삭제와 통합 회귀를 검증한다.
- Email/password, magic link, SMS, Android native Auth, profile/nickname/friends, app-provided manual identity management, marketing consent는 Wave 3 범위 밖이다. 같은 verified email은 Supabase Auth automatic linking을 따른다.
- 코드 구현과 hosted/physical 승격 gate를 분리한다. Production Supabase, production legal documents, post-commit claim evidence lifecycle과 3D 앱 내 계정 삭제 전에는 release하지 않는다.
- 7일 유예 soft deletion/recovery는 즉시 영구 삭제 뒤의 명시적 후속 기능이다.

## P0 Wave 4: 제품 완성

- 개인정보 최소화 diagnostic schema, Mobile/Watch bounded journal, Watch-to-iPhone 전용 transfer/ACK, 고정 분류 incident marker, Settings JSONL export와 cross-device purge를 구현한다. 현재는 설계만 승인됐으며 구현 완료로 표시하지 않는다.
- Watch 3일/1MB와 iPhone 14일/10MB retention, 개인정보 canary 차단, malformed/duplicate/ACK-loss recovery와 paired-device background/reconnect를 검증한다.
- 원격 수집 provider, 자동 upload, native crash/symbolication, 사용자 동의·opt-out, privacy policy, sampling과 server retention/deletion은 device-local 1단계 뒤의 별도 2단계로 유지한다.
- Memory/share를 별도 spec으로 재설계하고 현재 tab 구조에 연결한다.
- 사진·영상 첨부, export/share card, metadata redaction, 실패/취소 상태를 구현한다.
- Logbook profile·검색·filter·통계·review와 Planbook 반복 사용 흐름을 실제 저장소 기준으로 마무리한다.
- Watch sync retry/status, account/cloud 상태, storage/privacy control을 Settings에 추가한다.
- 접근성, 동적 글자 크기, 한국어/영어 문구, 빈 상태, 오류·offline 상태를 전체 흐름에서 검증한다.

### D1: 시작 전 배터리 상태와 저전력 경고

- **무엇·효용:** 기록 시작 전에 배터리와 저전력 상태를 보여 기록이 중단될 수 있는 도구 상태를 미리 파악하게 한다. docs-gap G07의 미구현 항목을 소유자가 기록 기능으로 한정해 승인했다.
- **경쟁 근거:** benchmark U2의 [Suunto Ocean 시작 전 상태](https://www.suunto.com/en-ca/Support/Product-support/suunto_ocean/suunto_ocean/scuba-diving/dive-setup/), S3의 [Peregrine 배터리 표시](https://cdn.shopify.com/s/files/1/0838/3732/1530/files/Peregrine_Manual-metric_2021.pdf?v=1710186733). 경쟁 제품의 남은 사용 시간 추정까지 채택하는 것은 아니다.
- **안전 확인:** 기록 도구 상태만 알리고 입수 적합성·잔여 안전 시간·수중 행동을 판단하지 않는다. 자동 햅틱이나 안전 경보는 이 승인에 포함되지 않는다.
- **상태:** 기본 상태 표시는 **지금 구현 가능**. 별도 저전력 임계값·강도는 **결정 필요**, 실제 저전력·지속 기록 영향은 **하드웨어 필요**다.

### D2: 보트 위 수면 카드

- **무엇·효용:** 마지막으로 관찰한 수면 전환 뒤 경과 시간, 직전 다이빙 시간·최대 수심, 오늘 다이빙 수를 한곳에 보여 보트에서 휴대폰 없이 기록을 확인한다. 가능하면 카드를 여는 complication을 제공한다. 기존 기록 중 수면 화면과 별개로 저장 후에도 찾기 쉬운 진입점이 필요하다.
- **경쟁 근거:** benchmark O1의 [Oceanic+ 수면 카드·complication](https://www.oceanicworldwide.com/faqs/), G1의 [Garmin G1 직전 다이빙 표시](https://www8.garmin.com/manuals/webhelp/GUID-2A58ED2A-14A3-4161-ADB5-259E1781AF1B/EN-US/Descent_G1_Series_OM_EN-US.pdf), U4의 [Suunto Ocean 수면·세션 화면](https://www.suunto.com/en-us/Support/Product-support/suunto_ocean/suunto_ocean/freediving/freedive-views/).
- **안전 확인:** 카운트업만 쓴다. 다음 입수 권고, 준비 상태, 회복 점수, 비행 금지 계산을 넣지 않는다. 오늘/세션 횟수를 구분하고 관찰 시각의 결측·불확실성을 표시한다. 경쟁 제품 카드의 안전 계산은 제외한다.
- **상태:** 사실 요약 카드는 **지금 구현 가능**. complication 제공 범위·갱신 정책은 **결정 필요**, 기기에서 실제 갱신·진입 확인은 **하드웨어 필요**다. 수면 시간 정의는 D4에 맞춘다.

### D3: 큰 글자 모드와 Dynamic Type

- **무엇·효용:** 항목 수를 줄이고 숫자·단위를 키우는 선택 화면과 메뉴·리뷰의 Dynamic Type 대응으로 마스크를 쓰거나 큰 글자가 필요한 사용자의 읽기 부담을 줄인다. inventory M13은 고정 크기와 축소 위주의 현행 화면을 지적했다.
- **경쟁 근거:** benchmark G1·G3·G4의 Garmin Big Numbers/Large Fonts([Mk3 화면 설정](https://www8.garmin.com/manuals/webhelp/GUID-9183E86B-2399-4CFC-AB50-EAFC6D6ED326/EN-US/GUID-C9A5E731-8826-4AD0-8087-F6E2EAC625D6.html)), S1의 [Teric Big 화면](https://cdn.shopify.com/s/files/1/0838/3732/1530/files/Teric_Manual_RevH5.pdf?v=1731106441), A7의 [Apple 접근성](https://developer.apple.com/design/human-interface-guidelines/accessibility).
- **안전 확인:** 값의 이름·단위·결측·비인증 표시를 보존한다. 특정 pt나 대비 수치만으로 수중 판독을 보증하지 않는다.
- **상태:** **지금 구현 가능**. 지원 크기, 마스크·장갑, 밝은/어두운 화면에서의 판독은 Wave 2의 **하드웨어 필요** 검증으로 남긴다.

### D4: 다이빙·전체 기록·수면 시간 분리

- **무엇·효용:** 세 시간을 따로 이름 붙여 저장·표시하고, 짧은 수면 구간을 같은 세션으로 묶더라도 물속 시간에 더하지 않는다. 보트 대기나 반복 하강 뒤에도 기록 의미를 비교할 수 있다. inventory H05·M03·M10·L01의 시간 정지·누락·구간 확정 시각·명칭 문제와 연결된다.
- **경쟁 근거:** benchmark O2의 [Oceanic+ 4.0 시간 구분](https://www.oceanicworldwide.com/oceanicplus-app-updates/), G5의 [Garmin 개별 다이빙 리뷰](https://www8.garmin.com/manuals/webhelp/GUID-9183E86B-2399-4CFC-AB50-EAFC6D6ED326/EN-GB/GUID-32B63BF5-5834-441B-985C-2FC344E90080.html), U4·U5의 [Suunto 세션·수면 시간](https://www.suunto.com/en-us/Support/Product-support/suunto_ocean/suunto_ocean/freediving/freedive-views/).
- **안전 확인:** 경과 시간과 관찰된 구간만 기록한다. 샘플 공백을 확실한 물속/수면 시간으로 채우지 않으며 생리적 회복·권장 휴식·감압 시간을 계산하지 않는다.
- **상태:** 시간 의미와 저장·표시 정리는 **지금 구현 가능**. 기존 timestamp·구간 필드와 새 저장 요구를 먼저 대조하고, 필드를 추가하면 schema·migration·동기화 호환성 검토가 필요하다. 실제 수면 전환 시각과 누락 구간은 **하드웨어 필요**다.

### D5: 기록 중 북마크

- **무엇·효용:** 기록 시각에 표시를 남겨 다이빙 뒤 휴대폰에서 메모할 지점을 찾는다. 물속 메뉴나 문자 입력이 필요 없다.
- **경쟁 근거:** benchmark S1의 [Teric 로그 태그](https://cdn.shopify.com/s/files/1/0838/3732/1530/files/Teric_Manual_RevH5.pdf?v=1731106441), A3·A15의 [Apple 동작 버튼 지침](https://developer.apple.com/design/human-interface-guidelines/action-button). Apple 지침은 조작 설계 근거이며 북마크 앱의 구현 사례라는 뜻은 아니다.
- **안전 확인:** 수중 행동 지시가 아닌 사후 메모용 사건 표시다. 한 번 누르기로 기록을 끝내거나 기존 종료 보호 조건을 바꾸지 않는다.
- **상태:** **결정 필요**. 현재 `Runtime/RecordingPageModel.swift`의 동작 버튼은 화면 넘김에 쓰이므로 화면 넘김 유지와 북마크 중 어느 역할을 줄지 먼저 정한다. docs-gap G19와 [개편 설계](../../../docs/superpowers/specs/2026-10-22-ui-ux-overhaul-design.md)의 범위 제외처럼 시각 표시 저장·동기화 contract 변경도 필요하다. 승인 뒤 실제 버튼 전달·중복 입력은 **하드웨어 필요**다.

## P0 Wave 5: 출시와 안전 경계

- App Store/TestFlight의 지원 Watch filtering, signing, entitlement, privacy manifest, 권한 문구, 데이터 삭제를 검증한다.
- 전체 migration, RLS/security, background delivery, crash recovery, export/privacy QA를 실행한다.
- 외부 dive-computer import 또는 decompression stop 표시는 source provenance와 read-only 사실 보존 범위부터 별도 고위험 spec으로 설계한다.
- [E1·E2](../questions/open-questions.md)의 상승 속도 표시·센서 이상 알림은 소유자 안전 검토를 먼저 거친다. 백로그 등록은 자동 경보의 구현 승인이 아니다.
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
- [ADR: 개인정보 최소화 device-local 진단 파이프라인](../decisions/adr-privacy-minimized-diagnostics.md)
- [열린 질문](../questions/open-questions.md)
