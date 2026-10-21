Source URL: project conversation; docs/superpowers/specs/2026-10-21-review-remediation-design.md; docs/superpowers/plans/2026-10-21-review-remediation.md; branch fix/review-remediation commits ad26dfd, 577b8a7, ba342b0, b38675e, cbfd97c, 4c9f377, 6581cc0, 612b1a6, 81e72f0, 2390e10, 9958013, d64ca85
Collected: 2026-10-21
Published: 2026-10-21

# 2026-10-21 프로젝트 리뷰 후속 수정 경계

2026-10-21 전체 리뷰에서 나온 문제 중 실기기 검증이 필요 없는 항목을 한 브랜치에서 고쳤다. 디자인은 Apple HIG를 따르고 UX 판단은 구현자에게 맡겼다. 계약 스키마, bundle ID, signing, entitlement, Supabase staging 배포는 바꾸지 않았다.

## Watch 세션과 수심 상태

- `RealDiveSessionCoordinator.prepareForNewSession()`은 saved summary, no-sample, 저장 실패 상태에서 다음 수동·Action Button·system 시작이 거부되지 않게 정리한다. 저장 실패 기록은 journal을 남긴 채 재시도 뒤에만 정리한다. 다시 물에 들어가면 saved summary를 닫고 Wet Ready로 간다.
- `DepthSensorCondition`(`normal`, `sensorError`, `beyondSensorRange`)과 recorder의 `LiveDepthSignal`(`awaitingFirstSample`, `live`, `stale`, `sensorError`, `beyondSensorRange`)을 추가했다. 유효 sample이 5초 넘게 없으면 `stale`이다. 실시간 화면은 `live`일 때만 수심과 상승 속도 숫자를 보이고, 아니면 `--.- m`와 상태 문구를 보인다.
- 저장 기록은 sensor range를 넘었거나 sample 공백이 30초를 넘으면 권장 스탑을 `unknown`으로 남긴다. `unsupportedDepth`에는 sensor 한계와 처음 넘은 시각을 기록한다.
- 권장 스탑의 일시정지·미완료 상태는 caution(앰버) 색과 "Recommended stop" 문구를 쓴다. `danger` 빨강은 쓰지 않는다.

## Watch 기록 정확도

- 저장·요약되는 최대/최근 상승 속도는 실시간 표시와 같은 `DisplayAscentRateEstimator` 출력으로 계산한다. 2026-07-18 결정에서는 `ScubaDiveEngine`의 historical 값을 raw 연속 sample 차이로 남겼지만, 1초 sensor 튐이 저장 최대값이 되는 문제 때문에 바꿨다. 요약과 sanitizer fallback도 sample을 같은 estimator로 재생한다.
- 권장 스탑 타이머는 sample 간격마다 최대 5초만 적립한다. 5초는 실시간 수심이 `stale`이 되는 기준과 같다.
- 수온은 측정 시각과 함께 보관하고, 60초 이내 값만 sample에 붙인다. 물 밖(`notSubmerged`) event와 recording 시작 때 비운다.
- `captureMode`가 없는 저장 기록은 `demo`로 읽는다. real provider는 `captureMode`를 도입한 커밋(e667202, 2026-07-05) 전까지 stub이었다. legacy `DiveSession` 변환도 `demo`다.
- Action Button 종료는 최신 water state가 `notSubmerged`이고 3분이 지났을 때만 허용한다. unknown state에서 1m 이하면 허용하던 분기를 지웠다.
- 데모·debug recording은 계획 연결(`sourcePlanLocalId`, 계획 title, `plan-` tag)을 떼고 시작하며, 저장 시 계획을 실행됨으로 표시하는 것은 real 기록뿐이다.
- 실행 시 삭제 복구(`resumePendingDeletions`)가 실패해도 저장 직전, companion 새로고침·activation, 앱 활성화 때 다시 시도한다. 늦게 성공하면 저장 목록만 다시 읽고, 끊긴 recording 복구는 진행 중 recording을 건드리지 않도록 다음 실행으로 미룬다.

## Watch UI

- Home의 계획 카드는 Dive Plans 화면으로 옮겼다. 계획을 누르면 다음 다이브에 쓰고, 다시 누르면 해제한다. 수심이 없는 계획은 `--.- m`다.
- 동기화 상태 enum(`pending`, `synced`, `failed`)은 계약 스키마에 있어 그대로 두고, 표시만 Waiting for iPhone, Saved on iPhone, Not sent to iPhone으로 바꿨다. 실패한 세션 상세 화면에 Send Again이 있다. 전송 완료와 iPhone 수신 확인 대기를 나누는 표시는 paired hardware 검증이 필요해 하지 않았다.
- 요약·목록·상세에 지원 수심 밖 표식(Outside watch support)을 붙인다. VoiceOver는 metric card와 summary row를 하나로 읽고 saved summary 뒤로 버튼에 이름을 준다.

## 모바일

- 로그·계획 삭제는 시스템 Alert로 확인한다. Watch에서 가져온 로그와 계정 동기화 로그는 함께 지워지는 대상을 알린다. 수정 중인 편집 화면을 벗어나면 변경 폐기를 확인한다. Undo는 넣지 않았다.
- Auth는 `SIGNED_OUT` event일 때만 로컬 세션을 닫는다. supabase-js가 만료 세션을 갱신하지 못해 null `INITIAL_SESSION`을 보내도 guest로 바꾸지 않는다. signOut이 실패하면 Keychain 세션을 직접 지운다.
- Watch payload import와 계획 전송은 principal이 정해진 뒤에만 시작한다. 계획 목록을 처음 읽기 전에는 빈 목록을 Watch로 보내지 않는다.
- 형식이 맞지 않는 Watch payload는 기기 로컬 거부 목록(최대 20건, 세션 ID·사유·시각만)에 남기고 Settings 기기 화면에 보인다. 같은 payload가 세 번 연속 import에 실패하면 기록하고 따로 빼서 native `prefix(8)` 창의 뒤쪽 payload가 막히지 않게 한다.
- 충돌 로그·계획 상세에 "이 기기 버전 유지", "다른 기기 버전 사용" 배너를 둔다. 유지는 최신 원격 revision 위로 다시 보내고, 원격 사본이 삭제됐으면 새 원격 행으로 보낸다. 이미 충돌 상태인 행을 삭제하면 사용자가 본 원격 revision 기준으로 삭제한다. 일반 삭제 충돌은 다른 기기 수정을 덮지 않고 충돌로 남긴다.
- hydrate는 soft-delete된 원격 행도 읽고(owner RLS가 허용), 대기 작업이 없는 synced 로컬 사본을 지운다.
- guest claim 오류는 PostgREST 응답 status로 분류한다. 401·403·`PGRST303`은 세션 만료, 0·5xx·429는 재시도 가능이다.

## 모바일 UI

- Home은 최근 다이브를 위치 조건보다 먼저 보이고, 누르면 로그 상세로 간다. 데모·테스트와 지원 수심 밖 표식을 붙이고, 로그 개수는 강조 파랑을 쓰지 않는다.
- `StatusPill`의 `warning` tone은 primary 파랑으로 보이던 것을 amber warning token으로 바꿨다. 권장 스탑 미완료는 빨강 `danger` 대신 caution tone과 "권장 스탑 미완료" 문구를 쓴다. 상세 화면의 데모 표식은 목록과 같은 muted tone이다.
- 프로필 차트와 새로고침 표시는 theme palette 색을 쓰고, 차트는 VoiceOver에 범위와 샘플 수를 요약한다.
- 동기화 결과는 가져온 수와 아직 가져오지 못한 수를 함께 알린다. 목록은 조회 실패(다시 시도), 검색 결과 없음(검색어 지우기), 빈 목록을 구분하고, Planning은 빈 상태 필터에 모든 계획 보기를 둔다. Claim sheet는 첫 새로고침이 실패하면 무한 준비 스피너 대신 오류와 다시 시도를 보인다.
- 탭과 선택 pill은 selected 상태를, 목록 행은 button role을 갖는다. 별점은 "5점 중 3점"으로 읽히고, number wheel은 VoiceOver 증감 동작을 지원하며, 뒤로·별점·pill·chip 컨트롤은 44pt 터치 영역을 갖는다. 상세 화면 뒤로 버튼은 모두 "뒤로"로 읽힌다.
- 폼 검증 메시지는 검증 시점의 언어로 만들고, 한국어는 라벨 받침에 맞춰 을/를·은/는을 고른다. 이전에는 영어 화면에서도 한국어 메시지가 나왔고 "반복 횟수을" 같은 조사 오류가 있었다. 물 상태, 단위(분/초), 날짜·시간 자리표시자도 번역한다.

## 검증과 저장소

- CI(`.github/workflows/ci.yml`)는 mobile typecheck·jest·lint, watch UI check, Supabase unit test·typecheck를 실행한다. `codex:check`도 mobile test·lint와 Supabase unit test를 포함한다.
- 실기기 항목은 Watch 체크리스트 D14-D19와 claim 체크리스트의 "2026-10-21 리뷰 후속 확인"으로 남겼다.
- 열린 질문: 오프라인 membership 신뢰 기한(`expires_at`)과 일반 서버 오류의 fail-closed 처리는 기존 설계대로 유지했다.
