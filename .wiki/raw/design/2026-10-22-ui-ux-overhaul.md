Source URL: docs/superpowers/specs/2026-10-22-ui-ux-overhaul-design.md; project conversation (2026-10-22 모바일·워치 UI/UX 개편 세션); commits 246026e, e17527c, fa93695, fa3dd3e, 56e5e04, 5a49297과 같은 날 작업 트리; apps/mobile/src/constants/async-feedback.ts; apps/mobile/src/hooks/use-loading-feedback.ts; apps/mobile/src/components/ui/skeleton-block.tsx; apps/mobile/src/components/feedback/app-feedback.tsx; apps/mobile/src/providers.tsx; apps/mobile/src/states/auth.tsx; apps/mobile/src/states/account-data.tsx; apps/mobile/src/components/navigation/index.tsx; apps/mobile/src/utils/watch-session-to-dive-log-entry.ts; apps/mobile/src/screens/planning/plan-status.ts; apps/mobile/src/states/use-dive-plans.ts; apps/mobile/src/screens/auth/social-login-button.tsx; apps/mobile/src/i18n/resources.ts; apps/mobile/ios/DivenaryWatchApp/Runtime/DiveActionButtonIntents.swift; apps/mobile/ios/DivenaryWatchApp/Runtime/RecordingPageModel.swift; apps/mobile/ios/DivenaryWatchApp/Runtime/DiveHaptics.swift; apps/mobile/ios/DivenaryWatchApp/Views/RecordingHint.swift; apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings
Collected: 2026-10-22
Published: 2026-10-22

# 2026-10-22 모바일·워치 UI/UX 개편

소유자는 데이터 구조는 출시해 반응을 볼 만큼 갖췄지만 로그 입력·계획·로그인 화면과 전반적인 완성도가 프로덕션 수준이 아니라고 판단했다. 워치는 수중에서 터치가 막히고 Crown press를 앱 입력으로 쓸 수 없어 기록 중 조작 수단이 거의 없었다. 소유자는 `DESIGN.md`와 `.wiki/wiki/design/mobile-watch-ui-language.md` 규칙을 지키며 UI/UX를 전반적으로 손보고, 스켈레톤과 로딩 상태는 `~/Projects/naver-ad-bidder`의 로딩 전략을 그대로 따르라고 했다. 설계 문서는 `docs/superpowers/specs/2026-10-22-ui-ux-overhaul-design.md`이며 동작과 구조의 기준이다. 설계 문서에 따옴표로 적힌 화면 문구는 초안이고, 실제 문구는 모바일 `apps/mobile/src/i18n/resources.ts`와 워치 `Localizable.xcstrings`가 기준이다.

## 소유자 문구 규칙

- 화면 문구는 다이버가 자연스럽게 읽는 말로 쓴다. 개발자·시스템 용어(동기화 대상, outbox, claim, principal, import, provider, sample, runtime, session, guest 등)는 화면에 내보내지 않는다.
- 개념 하나에는 용어 하나만 쓴다.
- 한국어는 `합니다/세요` 체, `해 주세요`처럼 띄어 쓴다. 영어는 sentence case다.
- 모르는 값은 `--`다. 워치 실시간 값처럼 단위를 가진 자리는 `--.- m` 같은 모양을 유지한다.
- 앱은 인증된 다이브 컴퓨터가 아니며 권장 스탑 용어는 `권장 스탑` / `Recommended stop`이다.

## 문구 기준 요약

`~/Projects/naver-ad-bidder`의 `docs/wiki/experience/user-facing-copy-guidelines.md`와 관련 기록에서 옮긴 기준을 Divenary에 맞춰 요약했다.

- 사용자의 작업 언어로 쓰되 다이버에게 필요한 전문용어(수심, 버디, 수면 휴식 등)는 남긴다.
- 문장은 대상 → 확인된 상태 → 필요한 행동 순서로 쓴다.
- 저장 위치와 전송 방향을 구별한다. 워치 → iPhone 저장과 계정 백업은 다르며, iPhone 저장을 계정 백업처럼 쓰지 않는다.
- 요청·처리·저장·확인 완료를 구별한다. 계획 전송 요청은 워치에서 계획을 쓸 수 있다는 뜻이 아니다.
- 실패·빈 결과·미확인·이전 값을 구별한다. 조회 실패에 빈 상태 안내를 쓰지 않고, 새로고침 실패 때는 이전 내용을 보인다는 사실을 알린다.
- 모르는 값에 0이나 정상 상태를 넣지 않는다. 확인된 원인만 말하고(모든 로그인 실패를 서버 문제로 부르지 않는다), 사용자를 탓하지 않으며, 실제로 가능한 복구 행동만 안내한다.
- 버튼은 실제 행동과 범위를 말한다. 읽는 값과 바꾸는 행동을 구분한다. 빈 화면은 다음 행동으로 연결한다.
- 기본 화면에는 판단에 필요한 정보만 둔다. 샘플 수 같은 진단 정보는 기본 화면에서 뺀다. 짧게 하려고 대상·단위·조건을 지우지 않고, 여러 의미를 구분자 하나로 몰아넣지 않는다.
- 필드 오류는 필드 가까이에, 오류는 영향을 받는 작업 근처에 한 번만 알린다. 안내의 의미와 표시 강도를 맞춘다.
- Demo/Test 표식과 비인증 안내는 문구를 줄여도 남긴다. 실제·데모·테스트 출처를 유지한다.
- 기술 원문(오류 코드, enum, 식별자)과 사용자 문구를 분리한다. 과거 기록과 현재 상태를 구분한다(권장 스탑 기록·상승 속도는 사후 복기다).
- 접근성 문구도 같은 기준으로 검토하고, 좁은 화면과 큰 글씨에서 잘림을 확인한다. 문구 교체와 기능 변경을 구분한다.

## 용어 결정

감사 용어집에 lead override를 적용한 최종 용어다.

- 저장한 다이빙 기록: 다이빙 기록(문맥상 기록) / Dive log. 탭 이름 로그북 / Logbook은 유지한다.
- 한 번의 잠수: 다이빙 / Dive. 수중 체류 시간: 다이빙 시간 / Dive time. 워치의 기록 전체 경과 시간: 총 기록 시간 / Total time. 횟수: 다이빙 횟수 / Dive count.
- 장소: 다이빙 포인트 / Dive site. 다이빙 종류 / Dive type.
- 수심 그래프 / Depth chart, 수온 그래프 / Water temperature chart. 센서 측정 개수는 기본 그래프 설명에서 빼고, 남기는 상세 행에서는 수심 측정 횟수 / Depth readings로 쓴다.
- 워치 → 휴대폰: 워치 기록 가져오기 / Get watch logs. 워치 재전송: 다시 보내기 / Send again. 휴대폰 저장 확인: iPhone에 저장됨 / Saved on iPhone.
- 로그인 전 기록 / Records made before sign-in, 계정으로 옮기기 / Move to account. 계정 보관: 기록 백업 / Backup. 휴대폰에만 보관: 이 기기에만 저장.
- 수중 상태 / Water conditions. 호흡 기체 / Breathing gas, 공기 / Air. 훈련 목표 / Training goal. 로그인 / Sign in.
- 탱크 압력 / Tank pressure, 시작 압력 / Start pressure, 종료 압력 / End pressure. 감사 제안의 `잔압`은 시작 값에 쓰지 않는다(lead override).
- 권장 스탑 / Recommended stop, 스탑 구간 / Stop zone.
- 동작 버튼 / Action Button, 수중 잠금 / Water Lock(lead override). 크라운은 문장에서 `디지털 크라운`, 짧은 화면 chip에서 `크라운 ▸`이다. 영어는 Digital Crown이다.
- 데모 / Demo, 테스트 / Test.

## 로딩 전략 (naver-ad-bidder 이식)

- 1초 전에는 아무것도 보이지 않는다. 1초부터 스켈레톤 또는 spinner, 4초부터 멈춘 것처럼 보일 수 있는 곳에만 짧은 문구를 더하고, 10초부터 재시도·복구 action이나 실제 진행률을 보인다.
- 스켈레톤은 실제 layout 모양의 정적 자리 표시이며 처음부터 자리를 잡아 둔다(pulse·shimmer 없음). 최소 표시 시간은 없다. 앱 시작 shell도 같다.
- 재조회는 내용을 유지한다. 처음 불러오기 실패는 오류와 다시 시도다. 성공했는데 0건이면 빈 상태다.
- 버튼과 행은 0ms에 busy·disabled가 되고 1초 뒤 spinner가 보인다. 완료는 한 번(토스트 또는 결과 화면)만 알린다.
- 공유 코드: `src/constants/async-feedback.ts`(`ASYNC_FEEDBACK_TIMING` 1s/4s/10s, `CONTENT_LOADING_FEEDBACK`), `src/hooks/use-loading-feedback.ts`(`useLoadingFeedback`), `src/components/ui/skeleton-block.tsx`(`SkeletonBlock`, `useContentLoading`; `cn`으로 호출자 크기가 기본값을 대신한다), `InstrumentButton`의 `pending`, `Row`의 `pending`, `ListStateCard`의 `actionPending`.
- 워치는 저장 세션 목록을 동기로 읽어 스켈레톤이 없다. Home 센서 확인 중에는 실제 시작 카드를 비활성으로 그린다. 다이브 종료의 저장 중 화면은 즉시 보인다(저장이 main thread를 잡아 지연 timer가 동작할 수 없다). 실시간 수심·시간·상승 값에는 스켈레톤을 쓰지 않는다.

## 피드백 배너

- `useAppFeedback().notify()` 배너 host(`AppFeedbackProvider`)는 account-data gate(`AccountDataProvider`) 위에 둔다. 로그인·로그아웃으로 데이터 소유자가 바뀌면 navigation 전체가 시작 shell로 바뀌므로, 그 아래 두면 배너가 사라진다.
- 4초 뒤 자동으로 닫히고 VoiceOver에 한 번 알린다. action이 없는 결과(저장함, 로그인함, 워치 기록 가져오기 결과)에만 쓴다.
- 워치 자동 가져오기 토스트는 action(기록 보기)이 있어 다이버가 닫을 때까지 남는다. 배너는 그 토스트 위에 쌓인다.

## 시작 shell과 Auth 시간 제한

- Auth가 `bootstrapping`인 동안 account data는 공개를 미루고 시작 shell을 유지한다(guest 화면이 잠깐 보이지 않게 한다). shell은 10초에 오래 걸린다는 문구와 다시 시도를 보인다. Auth 확인 중에는 다시 시작할 시도가 없어 문구만 보인다.
- Auth 재검증의 network 단계는 10초로 제한한다. 시간 초과는 network 실패로 취급하고 로그아웃하지 않는다. claims·server user 확인의 시간 초과는 저장된 offline 계정을 연다. 동의 확인 실패·시간 초과는 guest로 연다. `supabase.md`의 "onboarding RPC 실패는 offline fallback 근거가 아니다" 규칙은 유지한다.

## 워치 가져오기 표시 전용 규칙

- 저장된 기본 사이트 `워치 다이브`와 스쿠버 기본 시작 압력 150 bar, 워치 내부 태그(`watch-capture`, `plan-<id>`, `planned-<n>m`, `debug-test-capture`)는 저장값을 바꾸지 않는다. guest claim 재사용이 `site_name`과 `manual_data`를 정확히 비교하고, `plan-<id>`가 기록과 계획을 잇기 때문이다.
- 화면과 검색에서는 숨기거나 기록되지 않은 값으로 보인다. 기본 사이트는 `워치 기록 · 날짜`(목록은 `워치 기록`) 대체 제목, 기본 압력은 숨김(편집기는 `-- bar`), 내부 태그는 목록·상세·편집기·검색에서 숨긴다.

## 계획

- `planned` 계획만 워치로 보낸다. 초안은 보내지 않는다.
- 상세의 워치 행은 그 계획의 현재 버전이 마지막으로 성공한 `updatePlannedDives`에 들어 있었을 때만 전송했다고 표시한다.

## 로그인 시트

- Apple과 Google 버튼은 한 쌍으로 그린다. 같은 50pt pill, 같은 라벨 크기, 각 브랜드 팔레트에서 고른 같은 극성이다.
- 마지막으로 쓴 provider를 먼저 두고 모서리에 작은 표시를 단다. 2026-10-22 소유자 요청이 2026-07-17 로그인 개편의 "provider 목록 위 최근 사용 라벨" 결정(`docs/superpowers/plans/2026-07-17-login-entry-redesign.md`)을 대체한다.

## 워치 수중 입력

- Action Button은 단계를 아는 intent 하나로 처리한다. 대기·Wet Ready·요약에서는 시작, 물속 기록 중에는 Live ↔ 세부 화면 전환, 기존 180초 규칙을 넘긴 수면에서는 종료 화면이 순환에 더해지고, 종료 화면에서 누르면 기존 종료 경로로 끝난다.
- 크라운 회전은 화면을 넘긴다(실제 기록에서만).
- 자동 화면 전환(10초 무입력, 단계 변화, 권장 스탑 시작, 수심 신호가 live를 벗어남, Always-On)은 햅틱을 울리지 않는다. 햅틱은 다이버의 조작에만 쓴다.
- 실제 기록 중 터치로 종료하지 않는다.
- 모든 화면은 depth gauge, 상태 chip, Demo/Test 표식, 지원 수심 밖 경고를 유지한다. 안내 chip은 다음 누르기가 무엇을 하는지 말한다. Always-On은 권장 스탑 라벨을 유지한다.
- 모델 식별자로 얻는 Ultra 판단은 힌트일 뿐이며 문구는 조건형으로 둔다.
- Home은 센서 확인 중 시작 카드를 비활성으로 두고, 수중 조작 안내 화면을 갖고, Demo는 보조 행이다.
- Demo/debug는 크라운 수심 조절과 자체 종료 경로를 유지한다.

## 최종 코드에서 확인한 사실

- `DivenaryStartDiveIntent`(첫 누르기)와 `DivenaryDiveActionIntent`(이후 누르기)는 같은 `DiveActionButtonBridge.performDiveAction()`을 실행하고, 결과가 종료 요청이 아니면 `DivenaryDiveActionIntent`를 다음 Action Button intent로 돌려준다. 수동 시작, system auto-launch, demo 시작은 `donateDiveAction()`으로 같은 chain을 donate한다. 이전의 end intent는 없다.
- `RealDiveSessionCoordinator.handleActionButtonPress()`는 단계별로 시작, `.rejected(.busy)`(저장 중·runtime 전환 중), 화면 전환, 종료 화면에서의 `requestActionButtonEnd()`를 고른다. `minimumHardwareEndElapsedSeconds = 180`과 `notSubmerged` guard는 그대로다.
- `RecordingPageModel`의 화면은 `live`, `details`, `end`다. `end`는 `notSubmerged`이고 180초가 지났을 때만 순환에 들어간다. 크라운은 `live`와 `details` 사이만 움직인다.
- 햅틱은 `WatchDiveHaptics`만 울리며 이벤트는 `start`, `pageChange`, `rejected`, `endRequested`, `saved`다. view는 햅틱을 울리지 않는다.
- `ActionButtonHint`는 `hw.machine`(시뮬레이터는 `SIMULATOR_MODEL_IDENTIFIER`)이 `Watch6,18`, `Watch7,5`, `Watch7,12`이면 Ultra로 본다. 목록은 실기기 확인 대상이다.
- `DepthAutoLaunchStatus`는 `requestAutoLaunchAuthorizationStatus` 결과를 `active`, `inactive`, `unknown`으로 읽고, 오류는 `unknown`이다.
- 한국어 catalog는 `동작 버튼`, `수중 잠금`, 문장의 `디지털 크라운`, chip의 `크라운 ▸`을 쓰고, `check-watch-ui-language.mjs`가 `세이프티`, `스톱`, `방수 잠금`, `세션`, `샘플`, `캡처`, 영어 `safety stop`과 medium(500) 글꼴 굵기를 막는다.
- `SurfaceEndDiveGate`는 이번 개편 전 커밋에서 이미 지워졌다. demo 기록은 toolbar의 xmark와 Action Button override로 끝낸다.

## 하드웨어에서만 확인할 수 있는 것 (미검증)

- 실제 Ultra에서 Action Button chain, 물속 화면 전환, 종료 화면에서의 종료·저장, 거부 안내.
- 수중 잠금 중 크라운 회전이 앱에 오는지.
- 수중 extended runtime 중 햅틱 전달과 웻슈트 너머 체감.
- Always-On 진입 시 Live 복귀와 갱신 주기, 손목을 내린 상태의 10초 복귀 시점.
- 41/46/49mm 배치(안내 chip과 수중 잠금 안내, 큰 숫자, 세부 화면, 권장 스탑 화면).
- Ultra 모델 식별자 목록.
- 한국어 watchOS 메뉴 이름(동작 버튼, 자동 실행, 물에 잠겼을 때, 수중 잠금).
- 실제 auto-launch 상태 값.

## 범위 밖으로 남긴 것

- 로그인·로그아웃 때 navigation을 유지하는 데이터 소유자 전환, 진행 중인 로그인 교환 취소.
- 워치 가져오기 저장 기본값 정리(claim 재사용 검토 필요), 워치 계획 수신 확인(contract 변경 필요).
- 계정 삭제(백엔드 필요), 센서 오류·권장 스탑·상승과 연결된 햅틱(안전 검토 필요), 다이브 중 순간 표시(contract 변경 필요).
- Home 날씨는 Open-Meteo 무료 endpoint를 쓰고 출처를 링크 없는 작은 글자로 적는다. 무료와 유료 API 선택, CC BY 4.0 링크 필요 여부는 공개 배포 전에 결정해야 한다.
