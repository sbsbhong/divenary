# 모바일 모션 (2026-10-23)

소유자 요청: 워치 Plumb 리디자인에 상응하는 애니메이션을 모바일 앱에 더한다. 화면 구조는 바꾸지 않는다. 차트, 버튼을 눌렀을 때의 반응, 스켈레톤과 로딩 표시, 그 밖에 애니메이션이 자연스러운 자리에만 넣는다. 애플 HIG의 모션 원칙(목적이 있고 짧고 일관되며 동작 줄이기를 따른다)과 위키 `design/mobile-watch-ui-language.md`의 로딩 규칙을 따른다. 결정은 Claude가 내렸다.

## 바뀌지 않는 것

- 로딩 전략: 1초 전에는 아무것도 보이지 않고, 스켈레톤은 정적이다(pulse·shimmer 없음). 최소 표시 시간도 없다. `ASYNC_FEEDBACK_TIMING`, `useLoadingFeedback`, `useContentLoading`, `SkeletonBlock`의 의미는 그대로다.
- 숫자는 굴리지 않는다(count-up 없음). 값은 처음부터 실제 값이다.
- 화면 이동은 native stack 기본 전환, 시트는 native이고 손대지 않는다. 탭 내용 전환에도 애니메이션이 없다(iOS와 같다).
- 햅틱은 더하지 않는다(새 의존성 금지).
- 모션은 안전 상태나 권장 스탑을 알리는 신호가 아니다.

## M1. 모션 값 한 곳

- `src/constants/motion.ts`에 모든 시간과 크기를 둔다. 컴포넌트는 숫자를 직접 쓰지 않는다(`async-feedback.ts`와 같은 방식).
  - `pressIn` 90 ms ease-out, 놓을 때 spring `{ duration: 320, dampingRatio: 0.85 }`
  - `PRESS_SCALE.control` 0.95(버튼, 알약, 탭, 뒤로), `PRESS_SCALE.card` 0.97(카드 하나가 통째로 눌리는 행: 로그북 행, Home 최근 기록 카드, 계획 행)
  - `fade` 180 ms, `appear` 240 ms와 `appearOffset` 8 pt, `dismiss` 160 ms, `stagger` 40 ms
  - `chartDraw` 900 ms, `sparklineDraw` 600 ms, `chartAreaDelay` 200 ms, `chartAreaFill` 600 ms, `chartSecondaryDelay` 150 ms
  - `reducedMotionFade` 200 ms
  - 연결 상태 확인 깜박임 `{ dim: 120, back: 240, opacity: 0.3 }`(이미 `settings/screen.tsx`에 숫자로 들어가 있으니 이 상수로 옮긴다)
- 동작 줄이기는 reanimated `useReducedMotion()`으로 읽는다. 이동·크기·그리기 애니메이션은 `reducedMotionFade` 투명도 전환으로 바뀐다. 누름 크기 반응은 손가락 바로 아래의 작은 직접 반응이라 동작 줄이기에서도 유지한다.
- 애니메이션은 transform과 opacity만 바꾼다. reanimated shared value와 worklet으로 돌리고, 프레임마다 React state를 바꾸지 않는다.

## M2. 누름 반응

- 지금 `style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.95 : 1 }] }]}`처럼 순간적으로 튀는 곳을 모두 같은 hook(`usePressScale(kind)`: `onPressIn`, `onPressOut`, animated style)으로 바꾼다. 누르면 90 ms에 줄고, 놓으면 spring으로 돌아온다. 비활성일 때는 줄지 않는다.
- 대상: `InstrumentButton`, `ScreenBackButton`, `SelectorPill`, 탭 `NavTab`, 소셜 로그인 버튼, Home 날씨 새로고침, 폼 picker·badge 필드, 기록 편집기와 워치 필드의 누름 요소, `picker-sheet`은 `control`. 로그북 `SessionListItem`, Home 최근 기록 카드, 계획 행, 통째로 눌리는 워치 자동 가져오기 토스트는 `card`.
- grouped-list `Row`와 `active:bg-muted`만 쓰는 행은 iOS 목록처럼 배경 강조를 그대로 둔다.

## M3. 나타나기와 사라지기

- 결과 배너(`AppFeedbackProvider`)와 워치 자동 가져오기 토스트: 나타날 때 `appear` 동안 8 pt 아래에서 올라오며 밝아지고, 사라질 때 `dismiss` 동안 흐려진다. 새 메시지가 이전 것을 바꾸면 cross-fade다. 동작 줄이기에서는 투명도만.
- 스켈레톤(또는 1초 전의 보이지 않는 자리)을 실제 내용이 바꿀 때: 내용이 `fade` 동안 나타난다. 움직이지 않는다. 처음 불러오기에서 내용으로 바뀌는 순간에만 쓰고, 재조회나 이미 보이던 내용에는 쓰지 않는다. 대상: Home 최근 기록 카드, 로그북 목록 첫 불러오기, 계획 목록 첫 불러오기, 상세 route의 `DetailSkeleton` → 상세, 기록 상세 프로필 스켈레톤 → 차트.
- 비동기로 늦게 나타나는 조건부 블록은 `fade`로 나타난다: 설정 연결 기기의 가져오지 못한 워치 기록 안내, Home `다음 다이빙` 행, 동기화 충돌 배너.
- 로그북이 보이는 동안 워치 가져오기로 새 행이 들어오면 새 행만 `appear` 동안 투명도로 나타난다. 처음 목록을 그릴 때, 페이지를 더 불러올 때, 검색어·태그를 바꿀 때, 목록이 비었다가 다시 찰 때(로그아웃, 계정 전환)는 애니메이션이 없다. FlatList와 함께 안정적으로 만들 수 없으면 이 항목은 빼고 보고한다.
- Home은 앱 실행 뒤 처음 나타날 때만 위에서부터 블록(제목 줄, 최근 기록, 다음 다이빙, 빠른 action, 날씨)이 `stagger` 간격으로 8 pt 올라오며 밝아진다. 다른 탭에서 돌아올 때는 반복하지 않는다. 동작 줄이기에서는 투명도만, 간격 없이.

## M4. 탭 막대

- 탭을 눌러 선택이 바뀌면 새로 선택된 아이콘이 한 번 작게 튄다(1 → 0.86 → 1 spring, 약 350 ms, SF Symbols bounce와 비슷하게). 처음 그릴 때와 이미 선택된 탭을 다시 누를 때는 없다. 탭 뒤 500 ms(`TAB_BOUNCE.tapWindow`) 안에 선택이 바뀌지 않으면 그 탭은 잊는다. 코드가 나중에 탭을 바꿀 때 튀지 않게 하기 위해서다. 동작 줄이기에서는 없다. 글자·색 바뀜은 즉시다.

## M5. 차트 그리기

- 기록 상세의 수심 그래프(`LogEntryProfile` depth): 그 기록의 그래프가 이번 앱 실행에서 처음 보일 때 한 번, 화면 전환이 끝나도록 `chartAfterPush`(300 ms)를 기다린 뒤 선이 왼쪽에서 오른쪽으로 `chartDraw` 동안 그려진다(ease-in-out). `preserveAspectRatio="none"`과 `vectorEffect="non-scaling-stroke"`가 있으니 stroke dash 대신 왼쪽에서 넓어지는 clip 사각형으로 드러낸다. 영역 채움은 같은 clip으로 선이 지난 자리에만 보이고, `chartAreaDelay` 뒤 600 ms 동안 0에서 원래 투명도로 밝아진다(물이 선 뒤를 따라 찬다). 같은 기록을 다시 열면 바로 끝 상태다. 기록 식별자는 prop(`animationKey`)으로 받는다.
- 이때 실제 로고(`docs/superpowers/specs/2026-10-23-watch-plumb-redesign/LOGO.md`의 경로만, 손으로 그린 가오리 금지)가 드러나는 선 끝을 따라간다. 워치 D16a와 같이 좌우로 뒤집어 머리가 진행 방향을 향한다: 화면 좌표의 선 기울기 각도를 `line`이라 하면 `transform: [{ rotate: line + 57 deg }, { scaleX: -1 }]`(CSS 순서, 뒤집기가 먼저 적용된다). 기울기는 viewBox가 아니라 실제 그려진 폭·높이로 계산한다(가로세로가 따로 늘어난다). 크기 22 pt(18 pt는 실제 화면에서 모양이 읽히지 않았다), 색은 선 색, 선이 움직이기 시작할 때 `fade` 동안 나타나고(화면 전환을 기다리는 동안에는 보이지 않는다) 그리기가 끝나면 `fade` 동안 사라진다. 점이 하나뿐이면 그릴 선이 없으니 로고도 없다. 접근성에서 숨긴다.
- 같은 화면의 수온 그래프는 `chartSecondaryDelay` 뒤 같은 방식으로 그려지고 로고는 없다.
- Home 최근 기록 카드의 `DepthSparkline`: 그 기록이 이번 실행에서 처음 보일 때 `sparklineDraw` 동안 같은 clip 방식으로 그려진다. 로고는 없다.
- 동작 줄이기: 그리기와 로고 없이 그래프가 `reducedMotionFade` 동안 나타난다.
- 탭이나 스크롤로 건너뛰기는 하지 않는다(짧다).
- 메모리 미리보기의 `SessionProfile`은 navigation에 없으니 손대지 않는다.

## M6. 로딩 표시 빈자리

- 설정 로그아웃: 확인창 전에 보내지 않은 변경 수를 읽는 동안 로그아웃 행이 바로 busy가 되고 1초 뒤 spinner가 보인다.
- 설정 계정 페이지의 보내지 않은 변경 수: 아직 읽지 못했으면 값 자리에 `useContentLoading` 스켈레톤(짧은 한 줄)이 1초 뒤 보인다.
- 워치 기록 도착 알림 스위치: 권한 요청을 기다리는 동안 비활성(busy)이다.
- 계획 체크리스트는 즉시 바뀌는 낙관적 저장이 맞으니 그대로 둔다.

## 검증

- jest는 reanimated mock으로 애니메이션을 끝 상태로 바로 보낸다. 테스트는 끝 상태(경로, 내용, 접근성)를 확인하고, 처음 볼 때만 로고가 붙는 규칙과 기울기·각도 계산 같은 순수 함수는 단위 테스트로 확인한다.
- `yarn mobile:typecheck`, `yarn mobile:test`, `yarn mobile:lint`, 가능하면 `yarn ios:build`. iPhone 시뮬레이터에서 화면을 직접 확인한다.
