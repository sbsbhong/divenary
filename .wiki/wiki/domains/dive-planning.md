# 다이브 계획 도메인

Sources: pre-Karpathy wiki page, 2026-06-28; mobile form validation and pressure metadata, 2026-06-28; 2026-10-22 모바일·워치 UI/UX 개편, 2026-10-22
Raw: [Pre-Karpathy: 다이브 계획 도메인](../../raw/domains/dive-planning.md); [Mobile form validation and pressure metadata](../../raw/domains/2026-06-28-mobile-form-validation-pressure-metadata.md); [2026-10-22 모바일·워치 UI/UX 개편](../../raw/design/2026-10-22-ui-ux-overhaul.md)
Sources: 워치 수정 커밋 2df2bd1과 현재 코드 대조, 2026-10-22
Raw: [2026-10-22 워치 기록 정확도와 화면 흐름 수정](../../raw/architecture/2026-10-22-watch-accuracy-and-flow-fixes.md)
Updated: 2026-10-22

## 요약

모바일 Planbook은 레크리에이션 다이빙 전 준비 내용을 기록하는 비중요 계획 알림이다. 계획값은 사용자의 의도와 준비 맥락이며, 실제 다이빙 기록이나 안전 계산 결과가 아니다.

## 현재 상태

모바일 앱은 `DivePlan`을 사용해 계획을 AsyncStorage 기반 `PersistentDivePlanRepository`에 저장한다. 상태는 `draft`, `planned`, `completed` 세 가지만 사용한다. `cancelled` 상태는 현재 구현하지 않는다.

계획은 `diveMode`와 optional `entryStyle`을 함께 갖는다. 현재 새 계획에서 선택 가능한 `diveMode`는 `scuba`와 `freedive` 두 가지이고, `entryStyle`은 shore, boat, pool 같은 입수 맥락을 뜻한다. 둘은 서로 다른 축이다.

Two-mode reset 이후 Planbook 기본 저장소는 v2 key namespace를 사용해 기존 local v1 Planbook 데이터와 분리한다.

## 상세

`DivePlan`은 site, buddy, gear, tags, objective, notes, checklist, planned values를 가진다. Planned values는 `plannedMaxDepthMeters`, `plannedDurationMinutes`, `gasLabel`, `waterCondition`, `visibilityExpectation`, `perceivedDifficulty`, `trainingFocus`, `repetitionTarget`, optional `plannedPressure`처럼 계획과 준비를 표현한다. Scuba 계획의 `plannedPressure`는 `unit`(`bar` 또는 `psi`), start, end를 가진 pressure metadata이며, 사용자의 준비 맥락일 뿐 gas remaining, reserve, turn pressure, emergency instruction이 아니다. Type에는 legacy pool 계획 field가 남아 있지만, 현재 새 계획 UI는 scuba/freedive field만 노출한다.

Planbook editor는 `diveMode`별로 다른 입력 section을 보여준다. Scuba 계획은 Air-only gas label, water condition, visibility expectation, perceived difficulty, planned pressure metadata를 다루고, freedive 계획은 repetition target, training focus, perceived difficulty를 다룬다. 숨겨진 모드 전용 field는 현재 선택된 계획값으로 저장하지 않는다.

완료 흐름은 사용자 부담을 줄이기 위해 자동 로그 작성이 아니다. 사용자가 계획 상세에서 `완료로 표시`를 누르면 그 자리의 시스템 Alert가 지금 기록을 작성할지 묻는다. 나중에 선택해도 계획은 완료 상태로 남고, 완료된 계획 상세에서 다시 `기록 작성`(`createLogFromPlan`)을 실행할 수 있다. 연결된 기록이 있으면 상세는 `기록 열기`를 보인다.

2026-10-22 개편부터 저장과 상태 변경은 다음 규칙을 따른다.

- 새 초안 저장은 계획 제목이나 다이빙 포인트 하나만 요구한다. 전체 필수 항목(날짜·시간, 다이빙 종류, 다이빙 포인트, 계획 최대 수심, 계획 다이빙 시간)은 새 계획 편집기의 `계획 확정`과 `planned` 계획 편집의 `저장`에서만 검사한다. 편집기에서 막히면 빠진 칸을 inline으로 보이고, 첫 오류 칸이 있는 section으로 이동하며 VoiceOver에 알린다. 초안 상세의 `계획 확정`이 막히면 버튼 아래에 빠진 항목을 나열하고 VoiceOver에 알린다. 필수 표시는 새 계획과 `planned` 계획 편집에서만 보인다.
- 기존 계획 편집은 `저장` 하나이며 현재 상태를 유지한다. `planned` 계획은 필수 항목을 모두 채운 상태로 남아야 한다. 상태 변경은 상세의 명시 action(계획 확정, 완료로 표시)으로만 한다.
- 준비 체크리스트는 상세에서 탭하면 바로 저장하고 저장 전에도 체크를 보이며, 실패하면 이전 상태로 되돌리고 안내한다. 기본 항목은 저장된 영어 문구 대신 `id`로 번역해 보인다. 진행은 `1/3`처럼 조용히 보인다. 상태 action은 진행 중인 체크리스트 변경을 함께 보낸다.
- 계획의 예상 압력은 `탱크 압력 메모` section의 `예상 시작 압력`·`예상 종료 압력`이며, 계획 메모이고 탱크 압력 판단 기준이 아니라고 적는다. 압력 값 선택에는 자주 쓰는 값 chip을 두지 않는다.
- 수중 상태 선택은 로그와 같은 공유 control이며 `unknown`을 새로 고를 수 없다. 예전에 `unknown`으로 저장된 계획은 선택 없음으로 보인다.
- 상세는 계획값을 측정값이 아니라 계획으로 표시한다. 목록 행은 날짜가 오늘 이전인 `planned` 계획에 muted `날짜 지남` chip을 붙이고 초안·완료 행에는 상태 chip을 붙인다. 상세는 완료되지 않은 계획(초안 포함)의 날짜가 오늘 이전이면 상태 chip 옆에 `날짜 지남`을 함께 붙인다.

계획에서 Logbook 초안으로 복사하는 값은 site, buddy, gear, tags, dive mode, optional `entryStyle`, Air gas label, optional scuba pressure metadata, objective/training focus/notes 같은 metadata로 제한한다. 계획 최대 수심, 계획 시간, 예상 시야, 예상 난이도, checklist 상태는 실제 측정값이 아니므로 Logbook measured value에 복사하지 않는다. 초안은 Logbook editor에서 사용자가 확인하고 저장해야 실제 `DiveLogEntry`가 된다.

워치로는 `planned` 상태이고 아직 기록으로 전환되지 않은 계획만 보낸다(`isWatchVisiblePlan`). 초안과 완료 계획은 iPhone에만 있다. 계획 상세의 워치 행은 iPhone이 실제로 아는 값만 쓴다. planned dive context는 수신 확인이 없는 최신값 전달이므로, 그 계획의 현재 버전(`updatedAt`)이 마지막으로 성공한 전송에 들어 있고 워치 연결 상태가 정상일 때만 `워치 전송 요청됨`이고, 그 밖의 보낼 계획은 `워치 전송 미확인`, 보내지 않는 계획은 `iPhone에서만`이다. 워치에서 계획을 고를 수 있는지는 확인할 수 없어 표시하지 않는다. 자세한 조건은 [모바일 구조](../architecture/mobile.md)를 따른다.

워치의 계획 선택은 Home에서 같은 모드의 실제 기록을 시작할 때만 적용한다. 계획 화면도 이 범위를 안내하며 자동 실행·동작 버튼 시작은 선택된 계획을 가져오지 않는다. Home 표시, 계획 목록 변경, 시작 직전에 선택 ID를 다시 확인하고, 실제 기록 저장 성공으로 실행된 계획이나 목록에서 제거된 계획은 선택을 해제한다. 선택 계획과 다른 모드로 시작할 때는 계획값을 물려받지 않는 기본 계획을 쓴다. 계획을 선택하지 않은 기본 시작에는 목표 수심·시간과 `planned-<n>m` 태그가 없고, 목표 수심 없는 계획에 18 m를 채우지 않는다. 계획값은 비중요 준비 메모이며 측정값이나 안전 판단 기준이 아니다. 구현 근거는 [Watch 앱 구조](../architecture/watch-app.md)를 따른다.

Watch 앱에서 모바일 계획을 선택해 기록을 시작하면 watch session은 `sourcePlanLocalId`와 `planTitle`을 함께 저장한다. 모바일 import는 이 id로 원본 계획을 찾아 계획 title, site, buddy, gear, tags, notes, dive mode, gas label, training metadata를 imported log의 manual overlay에 합치고, 원본 계획을 `completed` 상태와 `convertedLogLocalId`로 갱신한다. 이때 watch가 측정한 수심, 시간, 수온, sample profile은 watch capture 기준으로 유지하며 계획값으로 덮어쓰지 않는다.

현재 Planbook 기본 저장소는 principal namespace에 묶인 AsyncStorage 기반 persistent repository다. 로그인 상태의 계획은 account local-first outbox로 Supabase `dive_plans`와 동기화되며, 이 경계는 [모바일 구조](../architecture/mobile.md)와 [Supabase 구조](../architecture/supabase.md)를 따른다.

## 관련 문서

- [모바일 구조](../architecture/mobile.md)
- [다이브 로그 도메인](dive-log.md)
- [안전 규칙](safety-rules.md)
