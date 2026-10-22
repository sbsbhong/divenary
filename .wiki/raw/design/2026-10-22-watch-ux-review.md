Source URL: /private/tmp/claude-501/-Users-hongseongbin-Projects-diving-app/f4b09df3-cdb9-4f9a-b8ca-756d22c6ef72/scratchpad/watch-ux/benchmark/benchmark.md; /private/tmp/claude-501/-Users-hongseongbin-Projects-diving-app/f4b09df3-cdb9-4f9a-b8ca-756d22c6ef72/scratchpad/watch-ux/inventory/problems.md; /private/tmp/claude-501/-Users-hongseongbin-Projects-diving-app/f4b09df3-cdb9-4f9a-b8ca-756d22c6ef72/scratchpad/watch-ux/docs-gap/gaps.md; 저장소 소유자 직접 지시(2026-10-22)
Collected: 2026-10-22
Published: 2026-10-22

# 2026-10-22 워치 UX 리뷰와 승인된 백로그

## 수집 범위

소유자 요청에 따라 세 보고서의 의미와 판단을 보존한 한국어 요약이다. 원문 전체를 옮긴 자료가 아니며 직접 인용은 사용하지 않았다. 아래 출처 ID와 URL은 benchmark 보고서의 것을 유지한다. 외부 페이지를 이번 수집에서 다시 검증한 것은 아니다. 보고서의 정적 코드 관찰, 설계 제안, 실제 기기 검증 필요를 구별한다.

## 세 보고서 요약

- `benchmark/benchmark.md`: Apple HIG·Depth, Oceanic+, Garmin, Shearwater, Suunto의 숫자 배치, 물리 조작, 기록 상태, 저장·리뷰 방식을 비교했다. 채택 가능한 12개 패턴은 제안이며 Divenary에 이미 구현됐거나 실제 수중에서 검증됐다는 뜻이 아니다. 일부 HIG 본문은 직접 열리지 않아 검색에 노출된 Apple 문구에 의존했고 Workouts 본문은 확인하지 못했다. 오래된 설명서와 화면은 역사적 근거로 구별했다. Dive+/MySSI의 Apple Watch 수중 앱과 Hydro 다이빙 앱은 확인하지 못했으며, Mares는 제조사 근거가 있는 별도 사례다.
- `inventory/problems.md`: 저장 이력 읽기 실패가 빈 목록으로 보이는 문제, 마이그레이션 실패 때 원본 삭제, 저장 실패·Wet Ready의 막힌 경로, Always-On의 보이는 화면과 입력 대상 불일치, 샘플 공백 뒤 멈춘 시간·상태, 완료 계획 재사용을 우선 지적했다. 작은 글자·열 너비·대비는 코드 또는 계산 근거이며 실제 잘림이나 수중 가독성 측정이 아니다. 수온 신선도, 종료 대기·재시도 피드백, 시간 이름, 접근성도 다뤘다. 코드를 바꾸거나 빌드·실기기 테스트를 실행한 보고서가 아니다.
- `docs-gap/gaps.md`: 오래된 문서의 약속과 최신 설계·코드를 대조했다. 배터리·저전력 표시 부재(G07), 과거 센서 이상 햅틱 약속과 최신 보류 정책의 충돌(G08), 계획 수신 확인 부재(G11), 북마크의 contract·입력 결정 필요(G19)를 구별했다. 워치의 사후 입력 폼은 자동 저장과 iPhone 편집으로 대체됐고 Always-On은 이미 구현돼 있으므로 새 미구현 기능으로 세지 않는다. 기존 얕은 물·전경 동기화 관찰은 현재 빌드의 전체 실기기 통과를 뜻하지 않는다. 물리 입력, 실제 센서 범위·권한, 장시간·오프라인 동작은 별도 검증이다.

## 채택 가능한 12개 패턴

아래는 benchmark의 제안을 요약한 것이며, 전부의 구현을 승인한 목록은 아니다. 이번 소유자가 백로그로 승인한 범위는 뒤의 D·E다.

| 번호 | 패턴과 다이버에게 주는 이점 | benchmark 근거 | 기록 도구의 경계 |
|---|---|---|---|
| 1 | 이름 붙인 시간·수심 두 값을 고정 위치에 두어 한눈에 읽기 | Apple Depth A11, Teric S1, Suunto U2 | 현재/최대 수심을 구분하고 유효한 허가 범위의 값만 표시 |
| 2 | 항목을 줄이고 숫자를 키우는 큰 글자 모드와 Dynamic Type | Garmin G1·G3·G4, Teric S1, Apple A7 | 글자 크기는 접근성 기능이며 수중 판독 보증이 아님 |
| 3 | 크라운으로 2~3개 페이지를 예측 가능하게 이동 | Oceanic+ O1, Apple A2, Garmin G2, Peregrine S3 | 회전은 화면 탐색이며 기록 종료나 안전 설정 변경이 아님 |
| 4 | 동작 버튼으로 시각을 남겨 사후 메모 지점을 표시 | Apple A3·A15, Teric 로그 태그 S1 | 현재 화면 넘김 역할과 먼저 조정; 한 번 누르기로 종료하지 않음 |
| 5 | 기록 대기·잠수 구간·수면·저장 상태를 자동 전환하고 이름 표시 | Depth A11, Garmin G2, Suunto U4·U8 | 알 수 없는 센서 상태를 수면이나 입수 준비 완료로 바꾸지 않음 |
| 6 | 다이빙 시간·전체 기록 시간·수면 시간을 분리 | Oceanic+ 4.0 O2, Garmin G5, Suunto U4·U5 | 경과 시간 기록이며 회복·감압·비행 금지 계산이 아님 |
| 7 | 수면에서 의도적으로 기록을 끝내고 초안·저장 결과를 보존 | Apple Swim A9, Garmin G2, Peregrine S3, Suunto U3 | 기록 종료와 실제 다이빙 종료 지시를 구분 |
| 8 | 보트 위에서 수면 경과·직전 다이빙·횟수를 보는 카드와 진입 complication | Oceanic+ O1, Garmin G1, Suunto U4·U8 | 카운트업만; 다음 입수 권고·준비 상태·회복 점수 없음 |
| 9 | 프리다이빙 세션 안에 개별 하강 기록과 횟수를 유지 | Garmin G5, Suunto U4·U5, Oceanic+ O1 | 목표·최고 기록 유도·안전 수면 간격 처방 없음 |
| 10 | 저장 확인과 핵심 요약 먼저, 워치 상세 다음, 편집은 iPhone | Depth A11, Garmin G5, Suunto U7, Peregrine S3 | 로컬 저장과 폰 동기화 성공을 구분; 과거 사실만 리뷰 |
| 11 | 밝은 숫자·고정 위치·글/아이콘으로 상태를 중복 전달하고 Always-On에서도 유지 | Apple A4–A6, Peregrine S3, Oceanic+ O1 | 경보 모방 금지; 센서 자동 햅틱은 별도 검토, 사용자 조작 확인과 구분 |
| 12 | 시작 전 배터리·센서·권한·저장·미전송 상태를 보여 기록 보존 | Suunto U2·U7, Peregrine S3 | 안전 입수 판정이나 잔여 안전 시간 아님; 여유 저장 공간·미전송 보호는 Divenary 개선 제안 |

## 피할 패턴

- NDL, 감압 정지·천장, 수면 도달 시간, 기체·산소 독성, 비행 금지·고도 허용 계산.
- 상승 속도 막대, 상하 방향 화살표, 정지 지시, 안전/위험 구역 색상. 소유자는 현재 물속 상승 속도 숫자도 상승 지시로 읽힐 위험을 E1로 판단 요청했다.
- 실시간 나침반·입수점 복귀 안내, 프리다이빙 회복 점수·휴식 처방·깊이/시간 목표 경보·수중 성취 유도.
- Gauge Mode 또는 백업 다이브 컴퓨터라는 제품 설명.
- 물속 터치 전용·밀어서 종료·Water Lock 중 double tap 의존(A10), 크라운 길게 누르기를 앱 북마크로 전용(A2·A10).
- 한 번 누르기 종료, 암묵적 일시정지, 파괴적인 길게 누르기.
- 한 화면에 모든 수치, 이름 없이 바뀌는 값, 움직이는 게이지, 빨강/초록만으로 상태 구분.
- 어두운 화면의 값이 항상 최신이라는 가정, 오래된 수심을 현재로 표시, 결측을 0으로 대체.
- 모든 환경에 통하는 글자 크기·최대 밝기·수심별 색상 보증, 미전송 기록의 조용한 덮어쓰기.
- 오래된 화면이나 App Store URL만으로 현재 watchOS 기능을 단정.

## 소유자 결정: 2026-10-22

- A(기록 정확성)와 B(막힌 흐름)는 다른 작업에서 지금 수정 중이다. 이 자료는 완료나 검증 통과를 선언하지 않는다.
- D(경쟁 제품의 사실 기록 기능)와 E(소유자 결정)는 승인된 백로그로 남긴다. 일시적인 채팅 메모나 미승인 제안 목록이 아니다. 백로그 등록 승인은 입력 방식·안전 정책·contract 변경까지 승인했다는 뜻이 아니다.
- D1: 시작 전 배터리 상태·저전력 경고. 기록 도구 상태만 표시하고 안전 판단을 하지 않는다.
- D2: 마지막 수면 뒤 경과 시간, 직전 다이빙 요약, 오늘 다이빙 수를 보여주는 보트 위 수면 카드. 카운트업만 쓰며 다음 입수 권고·준비 상태는 없다. 가능하면 complication을 제공한다.
- D3: 항목을 줄이고 숫자를 키우는 선택 화면과 Dynamic Type 대응.
- D4: 다이빙 시간·전체 기록 시간·수면 시간을 각각 이름 붙여 저장·표시.
- D5: 나중에 메모할 지점을 남기는 기록 중 북마크. 동작 버튼은 지금 화면 넘김에 쓰므로 역할 결정이 먼저다. G19의 저장·동기화 contract 변경도 남아 있다.
- D6: 수심 측정 범위 밖에서도 읽을 수 있는 기록 화면 설계. 현재 공개 shallow 접근은 약 6 m로 스쿠버 대부분의 수심이 범위 밖이다. 40 m 제품 경계나 Ultra 하드웨어 사양이 더 깊은 센서 사용 권한을 주지 않는다(A12–A14).
- E1: 현재 비인증 참고값인 물속 상승 속도 숫자를 유지/숨김/수면 후 리뷰에만 표시 중 결정한다. benchmark의 상승 지시 회피 원칙과 현행 표시의 충돌이다.
- E2: 과거 센서 이상 햅틱+화면+지속 표시 약속과 현재 사용자 안전 검토 전 자동 햅틱 금지 중 방향을 결정한다. 승인 전 금지를 유지한다.
- E3: 최신값 전송만 있는 휴대폰→워치 계획의 수신 확인을 어떻게 추가할지 결정한다. 새 contract가 필요하며 세션 import ACK나 계정 cloud sync와 별개다.

## 충돌·현행 경계의 저장소 출처

- `.wiki/wiki/architecture/watch-app.md`: 라이브 상승 속도 추정 범위, 실제 기록 화면·동작 버튼, shallow entitlement 경계.
- `.wiki/wiki/domains/safety-rules.md`: 비인증 상승 참고값과 자동 센서·권장 스탑·상승 햅틱 금지.
- `.wiki/wiki/domains/diving-app-safety-ux-legal-notes.md`: 과거 UX 원칙·경고 계층·Critical Warning UX의 햅틱·지속 표시 약속.
- `docs/watch-dive-product-plan.md`: 센서·경고·햅틱 관련 과거 제품 약속.
- `docs/superpowers/specs/2026-07-05-watch-real-device-readiness-design.md`: 과거 이탈·일시정지 햅틱 설명.
- `docs/superpowers/specs/2026-10-22-ui-ux-overhaul-design.md`: 자동 햅틱 보류, 기록 중 순간 표시 및 계획 수신 확인의 범위 제외.
- `docs/architecture/watch-link-protocol.md`, `packages/contracts/schemas/watch-link-messages.schema.json`: 계획 최신값 전송과 세션·삭제 ACK의 계약.
- `apps/mobile/ios/DivenaryWatchApp/Runtime/RecordingPageModel.swift`, `Runtime/DiveHaptics.swift`, `Sync/WatchSyncTransport.swift`(뒤 두 경로는 같은 Watch source 기준): 화면 넘김, 조작 확인 햅틱, 계획 수신 처리의 현행 근거.

## benchmark 출처 URL 보존

ID는 원 보고서의 출처 ID다. 아래 URL의 제품 기능은 위 보고서가 확인한 범위로만 해석한다. 오래된 문서는 최신 화면의 증거가 아니며, 원 보고서의 조회 한계를 그대로 적용한다.

- A1: [Apple HIG: Designing for watchOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-watchos)
- A2: [Apple HIG: Digital Crown](https://developer.apple.com/design/human-interface-guidelines/digital-crown)
- A3: [Apple HIG: Action Button](https://developer.apple.com/design/human-interface-guidelines/action-button)
- A4: [Apple HIG: Always On](https://developer.apple.com/design/human-interface-guidelines/always-on)
- A5: [Apple: Designing your app for the Always On state](https://developer.apple.com/documentation/watchos-apps/designing-your-app-for-the-always-on-state/)
- A6: [Apple Support: Use Always On](https://support.apple.com/en-us/105074)
- A7: [Apple HIG: Typography](https://developer.apple.com/design/human-interface-guidelines/typography); [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- A8: [Apple HIG: Workouts](https://developer.apple.com/design/human-interface-guidelines/workouts); [Apple: Running workout sessions](https://developer.apple.com/documentation/healthkit/running-workout-sessions)
- A9: [Apple Watch User Guide: Go for a swim, watchOS 26](https://support.apple.com/guide/watch/go-for-a-swim-apd09135915f/26/watchos/26)
- A10: [Apple Support: Water Lock and water ejection](https://support.apple.com/en-mn/108352)
- A11: [Apple Watch User Guide: Log underwater activity, watchOS 26](https://support.apple.com/en-gb/guide/watch/apdd1a0ae6f4/26/watchos/26)
- A12: [Apple Support: Use the Depth app on Apple Watch Ultra](https://support.apple.com/en-au/102273)
- A13: [WWDC23: What's new in Core Motion, session 10179](https://developer.apple.com/videos/play/wwdc2023/10179/)
- A14: [Apple: CMWaterSubmersionManager](https://developer.apple.com/documentation/coremotion/cmwatersubmersionmanager); [Accessing submersion data](https://developer.apple.com/documentation/coremotion/accessing-submersion-data)
- A15: [Apple: Responding to the Action Button on Apple Watch Ultra](https://developer.apple.com/documentation/appintents/actionbuttonarticle)
- A16: [WWDC23: Explore enhancements to App Intents, session 10103](https://developer.apple.com/videos/play/wwdc2023/10103/); [WWDC24: Bring your app's core features to users with App Intents, session 10210](https://developer.apple.com/videos/play/wwdc2024/10210/); [WWDC25: What's new in watchOS 26, session 334](https://developer.apple.com/videos/play/wwdc2025/334/)
- O1: [Oceanic+: FAQ](https://www.oceanicworldwide.com/faqs/)
- O2: [Oceanic+: App updates](https://www.oceanicworldwide.com/oceanicplus-app-updates/)
- O3: [Apple Newsroom: Oceanic+ and Apple Watch Ultra](https://www.apple.com/newsroom/2022/11/reach-new-depths-with-the-oceanic-plus-app-and-apple-watch-ultra/)
- G1: [Garmin Descent G1 manual](https://www8.garmin.com/manuals/webhelp/GUID-2A58ED2A-14A3-4161-ADB5-259E1781AF1B/EN-US/Descent_G1_Series_OM_EN-US.pdf)
- G2: [Garmin Mk3: Going Diving](https://www8.garmin.com/manuals/webhelp/GUID-9183E86B-2399-4CFC-AB50-EAFC6D6ED326/EN-GB/GUID-F5BB5FFC-1071-4C7B-9968-2B2D985C4574.html); [Garmin Mk3: Dive modes](https://www8.garmin.com/manuals/webhelp/GUID-9183E86B-2399-4CFC-AB50-EAFC6D6ED326/EN-US/GUID-B0F7269A-8B02-48F3-AED2-CECB581B361F.html)
- G3: [Garmin Mk3: Apnea and Apnea Hunt data screens](https://www8.garmin.com/manuals-apac/webhelp/descentmk3series/EN-SG/GUID-B808893A-C63E-416F-9D8E-C00E671ED93C-5138.html)
- G4: [Garmin Mk3: Changing screen settings](https://www8.garmin.com/manuals/webhelp/GUID-9183E86B-2399-4CFC-AB50-EAFC6D6ED326/EN-US/GUID-C9A5E731-8826-4AD0-8087-F6E2EAC625D6.html)
- G5: [Garmin Mk3: Viewing the Dive Log Glance](https://www8.garmin.com/manuals/webhelp/GUID-9183E86B-2399-4CFC-AB50-EAFC6D6ED326/EN-GB/GUID-32B63BF5-5834-441B-985C-2FC344E90080.html)
- G6: [Garmin Mk3: Surface Interval Glance](https://www8.garmin.com/manuals-apac/webhelp/descentmk3series/EN-SG/GUID-8EDDB7D8-0553-421C-93A8-9FF8CF7263A8-6617.html); [Garmin G1: System Settings](https://www8.garmin.com/manuals/webhelp/GUID-2A58ED2A-14A3-4161-ADB5-259E1781AF1B/EN-US/GUID-1500E73F-F386-49AF-A542-25D4B1655A08.html)
- S1: [Teric manual, Rev H](https://cdn.shopify.com/s/files/1/0838/3732/1530/files/Teric_Manual_RevH5.pdf?v=1731106441)
- S2: [Shearwater Teric support](https://shearwater.com/pages/teric-support); [Teric/Tern release notes v37](https://cdn.shopify.com/s/files/1/0711/0538/0397/files/Teric-Tern-Release-Notes-v37-English_2.pdf?v=1768605625)
- S3: [Peregrine manual](https://cdn.shopify.com/s/files/1/0838/3732/1530/files/Peregrine_Manual-metric_2021.pdf?v=1710186733); [current support](https://shearwater.com/pages/peregrine-support)
- U1: [Suunto Ocean: Touch screen and buttons](https://www.suunto.com/en-us/Support/Product-support/suunto_ocean/suunto_ocean/getting-started/touch-screen-and-buttons/)
- U2: [Suunto Ocean: Dive setup](https://www.suunto.com/en-ca/Support/Product-support/suunto_ocean/suunto_ocean/scuba-diving/dive-setup/)
- U3: [Suunto Ocean: Dive settings](https://www.suunto.com/en-ca/Support/Product-support/suunto_ocean/suunto_ocean/scuba-diving/dive-settings/)
- U4: [Suunto Ocean: Freedive views](https://www.suunto.com/en-us/Support/Product-support/suunto_ocean/suunto_ocean/freediving/freedive-views/); [Snorkeling and mermaiding](https://www.suunto.com/Support/Product-support/suunto_ocean/suunto_ocean/freediving/snorkeling-and-mermaiding/)
- U5: [Suunto Ocean: Freedive switch window](https://www.suunto.com/Support/Product-support/suunto_ocean/suunto_ocean/freediving/switch-window-for-freediving/)
- U6: [Suunto Ocean: Button and screen lock](https://www.suunto.com/en-ca/Support/Product-support/suunto_ocean/suunto_ocean/settings/button-and-screen-lock/)
- U7: [Suunto Ocean: Dive logs](https://www.suunto.com/en-ca/Support/Product-support/suunto_ocean/suunto_ocean/dive-logs/)
- U8: [Suunto D5 user guide](https://www.suunto.com/en-us/Support/Product-support/suunto_d5/suunto_d5/reference/); [current full guide](https://us.suunto.com/pages/suunto-d5-user-guide)
- M1: [Dive+ — developer's App Store listing](https://apps.apple.com/us/app/dive-worlds-diving-community/id1251506403)
- M2: [SSI App — developer's App Store listing](https://apps.apple.com/us/app/ssi-app-education-and-fun/id1249389209)
- M3: [Hydro — Water Tracker listing](https://apps.apple.com/us/app/hydro-water-tracker/id6761480955)
- M4: [Mares Dive App for Apple Watch Ultra](https://www.mares.com/en_US/mares-ultra-app); [Mares App Store release history](https://apps.apple.com/us/app/mares-app/id1625641063)
- R1: [NOAA: Why is the ocean blue?](https://oceanservice.noaa.gov/facts/oceanblue.html)
- R2: [NOAA: Light Attenuation Kd490 dataset](https://www.fisheries.noaa.gov/inport/item/66147)
- R3: [W3C: WCAG 2.2 Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
