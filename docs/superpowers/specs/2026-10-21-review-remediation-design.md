# 전반 리뷰 지적사항 수정 설계

## 배경

2026-10-21 전반 리뷰에서 워치 기록 런타임, 모바일 UX, Auth/데이터 주체 경계, 워치↔폰 연결, 계정 동기화, 검증 게이트에 걸친 문제가 확인됐다. 사용자는 UX 판단을 위임했고, 실기기 검증이 필요한 항목을 제외한 나머지를 이 브랜치(`fix/review-remediation`)에서 순서대로 수정하도록 요청했다. 디자인 기준은 Apple HIG와 `.wiki/wiki/design/mobile-watch-ui-language.md`다.

## 목표

- 다이브 기록이 조용히 빠지거나, 검증되지 않은 센서값이 실측처럼 보이는 경로를 없앤다.
- 되돌릴 수 없는 삭제와 입력 유실을 사용자 확인 없이 일으키지 않는다.
- 로그인 사용자의 데이터가 일시적인 네트워크·서버 상태 때문에 guest로 귀속되거나 강제 로그아웃되지 않게 한다.
- 실패를 `console.warn`에만 남기지 않고, 사용자가 원인과 다음 행동을 알 수 있게 한다.
- 자동 검증 게이트를 녹색으로 만들고 `codex:check`와 CI에서 실제로 돌게 한다.

## 비목표 (실기기 검증이 필요해 제외)

- 다이브 중 크래시 후 같은 세션으로 재개하기. watchOS가 복구한 runtime session을 실제로 넘겨주는 순서는 기기에서만 확인할 수 있다.
- WatchConnectivity 프로토콜 변경: 거부 ACK, 워치 재전송 요청, 다중 워치 삭제 ACK 구분. 실제 전달·재시도는 paired hardware가 필요하다.
- 저휘도(`isLuminanceReduced`) 표시, 리마인더 햅틱, 41mm 가독성 튜닝.
- 개인정보 최소화 진단 파이프라인. Watch background/reconnect/ACK 재시도가 paired hardware gate다.
- CoreMotion이 허가 깊이를 넘었을 때 실제로 어떤 값을 주는지 확인하기. 코드는 모든 상태를 방어적으로 처리하되, 실제 동작은 실기기 체크리스트로 남긴다.

## 결정

### 1. 검증 게이트

- 낡은 소스 계약 테스트는 9/01–9/02 spec이 승인한 현재 동작에 맞춘다. `ios-auth-configuration`은 워치 타깃이 shallow-depth entitlement만 갖고 Sign in with Apple entitlement는 갖지 않는지 검사한다.
- lint 에러는 0개로 만든다. 어디서도 import하지 않는 gluestack 벤더 컴포넌트는 삭제한다.
- `codex:check`에 mobile jest, mobile lint, `watch:ui:check`, `@repo/supabase` test를 넣는다.
- `.github/workflows/ci.yml`을 추가해 ubuntu에서 typecheck, jest, lint, `@repo/supabase` test를 돌린다. macOS 빌드는 비용 때문에 넣지 않는다.

### 2. 워치 연속 다이브

- 저장 요약(`savedSummary`), 샘플 없음(`noSamples`), 시작 저장 오류(`startPersistenceError`) 상태에서 watchOS가 새 세션을 넘기거나 Action Button으로 시작하면, 이전 화면을 자동으로 닫고 새 기록을 시작한다. 요약은 저장된 세션 목록에서 다시 볼 수 있으므로 잃는 것이 없다.
- 완료 저장 오류(`savePersistenceError`) 상태에서는 먼저 저장을 한 번 더 시도한다. 그래도 실패하면 기록기를 journal을 지우지 않는 방식으로 풀고 새 기록을 시작한다. 실패한 세션의 journal은 디스크에 남아 다음 실행 때 interrupted 세션으로 복구된다.
- 물에 잠기면(`submerged`) 요약 화면에서도 Wet Ready로 넘어간다.

### 3. 워치 센서 상태

- 기록기는 실시간 수심 신호 상태를 공개한다: 첫 샘플 대기, 정상, 오래됨(유효 샘플 5초 이상 없음), 센서 오류, 센서 허가 깊이 초과.
- 정상이 아닐 때 기록 화면은 수심과 상승 속도를 `--`로 표시하고, 짧은 저채도 상태 문구를 보인다. 마지막 값을 실시간처럼 보이지 않게 한다.
- 스쿠버 세션에서 허가 깊이 초과가 한 번이라도 있었으면, 저장할 때 기존 계약의 `unsupportedDepth`에 `limitMeters = 센서 허가 깊이`로 기록하고 safety stop 상태는 `unknown`으로 둔다. 샘플 공백이 30초를 넘은 경우에도 safety stop을 `unknown`으로 둔다. 계약 schema는 바꾸지 않는다.

### 4. 삭제와 편집 보호 (모바일)

- 로그·계획 삭제는 Apple HIG의 파괴적 작업 패턴을 따라 시스템 Alert로 확인한다. 제목은 "로그를 삭제할까요?", 버튼은 "취소"와 파괴적 스타일의 "삭제"다. 워치에서 가져온 로그는 "워치의 원본 기록과 다른 기기의 사본도 함께 삭제되며 되돌릴 수 없습니다"라고 알린다.
- Undo는 넣지 않는다. 삭제 묘비가 즉시 워치·클라우드로 전파되는 구조라서, 지연 삭제는 별도 설계가 필요하다.
- 편집 화면에서 저장하지 않은 변경이 있으면 뒤로 가기, 스와이프, 취소 버튼을 막고 "변경 사항을 버릴까요?" Alert(계속 편집 / 버리기)를 띄운다.
- routed 편집기에도 첫 오류 필드로 스크롤하는 기능을 연결한다.

### 5. Auth와 데이터 주체

- Auth 구독은 이벤트 종류를 함께 전달한다. 앱은 `SIGNED_OUT`일 때만 세션을 닫는다. 복원 중에 들어온 `INITIAL_SESSION` null은 복원 흐름에 맡긴다. supabase-js는 만료된 세션을 오프라인에서 갱신하지 못하면 `INITIAL_SESSION`을 null로 보내므로, 이것을 로그아웃으로 처리하면 2026-07-13 설계의 "명백한 token 무효화만 logout" 규칙을 어긴다.
- signOut이 실패하면 Keychain에 저장된 세션을 직접 삭제한다. supabase-js `_signOut`은 만료 세션을 갱신하지 못하면 세션을 지우지 않고 오류만 돌려준다.
- 유지하는 기존 결정: 오프라인 membership은 저장 세션의 `expires_at`이 남아 있을 때만 허용하는 bounded local trust이고, 일반 서버 오류(5xx 포함)는 오프라인 인증으로 쓰지 않는다. 신뢰 기간을 늘리는 것은 보안 결정이라 이 작업에서 바꾸지 않고 열린 질문으로 남긴다.
- auth 상태가 확정되기 전(`bootstrapping`, `authenticating`, `pendingOnboarding`)에는 워치 import drain과 워치 계획 전송을 미룬다. 워치는 원본을 보관하고 있으므로 지연만 생긴다.
- 계획 목록은 처음 불러오기가 끝난 뒤에만 워치로 보낸다.

### 6. 워치↔폰 연결 (폰 쪽)

- 형식이 맞지 않아 버린 워치 payload는 기기 로컬 거부 목록(최대 20건, 세션 ID·사유·시각만 저장)에 남긴다. Settings 기기 화면에 "가져오지 못한 워치 기록"으로 보여주고, 앱 업데이트가 필요할 수 있음을 알린다. 사용자 콘텐츠나 원본 payload는 저장하지 않는다.
- 한 번에 8개씩 넘기는 drain에서 앞쪽 실패 때문에 뒤쪽이 영원히 막히지 않게 한다.
- Settings 기기 상태에 새로고침 동작을 넣고, 조회 실패를 "브리지 없음"으로 바꾸지 않는다.

### 7. 계정 동기화

- 충돌(conflict) 로그·계획의 상세 화면에 배너를 보여준다. "다른 기기에서 수정된 버전이 있어요"와 두 동작("이 기기 버전 유지", "다른 기기 버전 사용")을 둔다. iCloud 문서 충돌 해결과 같은 방식이다.
  - 이 기기 버전 유지: 원격 revision을 기준으로 로컬 내용을 새 upsert로 다시 보낸다.
  - 다른 기기 버전 사용: 원격 내용을 synced로 덮어쓰고 충돌 기록을 지운다.
  - 충돌 행을 삭제하면 원격 revision을 기준으로 삭제를 다시 보낸다.
- 원격 삭제를 다른 기기로 전파한다. hydrate가 삭제된 원격 행을 함께 읽고, 대기 작업이 없는 synced 로컬 사본을 지운다.
- 원격 오류 분류에 HTTP status를 반영한다. 네트워크·5xx·세션 만료는 재시도 가능한 오류로 분류한다.

### 8. 워치 기록 정확도

- 저장되는 최대 상승 속도는 실시간 표시와 같은 smoothing estimator 출력의 최댓값으로 계산한다.
- Safety stop은 샘플 사이 간격 중 최대 5초까지만 구간 시간으로 인정한다.
- 수온은 세션을 시작할 때와 물 밖으로 나왔을 때 초기화하고, 60초보다 오래된 수온은 샘플에 붙이지 않는다.
- `captureMode`가 없는 옛 기록은 `demo`로 읽는다. 실측 provider가 생기기 전 기록이다.
- Action Button 종료는 spec대로 물 밖(`notSubmerged`)일 때만 허용한다.
- 데모 기록은 실제 계획과 연결하지 않고, 계획을 실행됨으로 표시하지 않는다.
- 실행 시 삭제 복구가 실패해도 저장 직전과 화면 활성화 때 다시 시도한다.

### 9. UI/UX

- 권장 safety stop의 일시정지·미완료 상태는 caution(앰버) 톤을 쓰고 "권장 스탑" 문구를 붙인다. `danger` 빨강은 쓰지 않는다. 워치 테마에 caution 색 토큰을 추가한다.
- 워치 실시간 화면에 Demo 표식을 계속 보이고, 요약·목록·상세에 지원 범위 밖 표식을 유지한다.
- 워치 Home에서는 계획 목록을 별도 "Dive Plans" 화면으로 옮기고, 수심이 없는 계획은 `--`로 표시한다.
- 워치 동기화 상태 라벨에서 전송 대기와 수신 확인 대기를 구분하고, 실패 행에서 다시 보내기를 제공한다.
- 모바일 Home은 최근 다이브를 날씨 카드보다 먼저 보여주고, 로그 개수에 primary 파랑을 쓰지 않는다. 최근 로그 카드에 데모·지원 범위 밖 표식을 붙이고, 누르면 로그 상세로 간다.
- 차트 색은 테마 토큰을 쓴다.
- 동기화 결과에 부분 실패 건수를 보인다. claim 첫 새로고침 실패 시 오류와 재시도를 보인다. 목록은 조회 실패, 검색 결과 없음, 빈 목록을 구분한다.
- 접근성: 탭과 선택 pill에 selected 상태를 주고, 별점에 "5점 중 3점" 라벨, 프로필 SVG 요약 라벨, wheel picker 증감 동작, 44pt 터치 영역을 넣는다.
- 하드코딩된 사용자 문자열은 i18n으로 옮긴다.

### 10. 문서와 위키

- AGENTS.md와 위키 UI 문서에서 Memory 탭 설명을 현재 상태로 고친다.
- 동작이 바뀐 경계(연속 다이브, 센서 상태, Auth 이벤트, 거부 payload, 충돌 해결, 원격 삭제 전파, caution 톤)를 `.wiki/raw/`에 근거로 남기고 관련 compiled article을 갱신한다.
- `.DS_Store`를 추적 대상에서 빼고 `.gitignore`에 추가한다.

## 검증

- `yarn mobile:typecheck`, `yarn workspace @repo/mobile test`, `yarn workspace @repo/mobile lint`, `yarn workspace @repo/mobile watch:ui:check`, `yarn workspace @repo/supabase test`
- `yarn watch:build`와 워치 XCTest(`DivenaryWatchAppTests` scheme, watchOS Simulator)
- iPhone 네이티브를 바꾸면 Pods를 준비해 `yarn ios:build`를 돌린다. 준비할 수 없으면 그 사실을 보고한다.
- 실기기 확인이 필요한 항목은 `docs/2026-07-18-watch-underwater-runtime-device-checklist.md`와 관련 체크리스트에 행으로 추가한다.
