# Mobile/Watch UI 언어

Sources: pre-Karpathy wiki page, 2026-06-28; Diving App repository implementation, 2026-07-07
Raw: [Pre-Karpathy: Mobile/Watch UI 언어](../../raw/design/mobile-watch-ui-language.md); [Watch debug demo sync logbook UX](../../raw/architecture/2026-07-07-watch-debug-demo-sync-logbook-ux.md)
Updated: 2026-07-07

## 요약

`diving-app`의 모바일과 watchOS UI는 **iOS grouped base + dive instrument accent**를 공통 방향으로 삼는다. 기본 구조는 Apple 앱처럼 조용하고 정돈된 grouped 화면을 따르고, 다이빙 앱의 성격은 수심, 시간, profile, 상태 같은 계기 요소 한두 곳에만 집중한다. 현재 watch recording은 full-height depth gauge와 compact live values를 중심으로 하고, 모바일 status badge는 low-chroma chip으로 제한한다.

## 현재 상태

이 결정은 `DESIGN.md`의 Apple-inspired token과 사용자의 UI 피드백을 모바일 앱과 watchOS 앱에 맞게 해석한 것이다. `DESIGN.md`는 Apple 웹/마케팅 page의 full-bleed tile 언어를 포함하지만, 모바일 앱과 watchOS 앱에는 그대로 복사하지 않는다.

모바일 앱의 기준은 다음과 같다.

- iOS `Settings`, `Health`, `Fitness`처럼 grouped list와 조용한 card surface를 기본으로 한다.
- 화면마다 핵심 시각 요소는 하나만 둔다.
- 다이빙 도메인감은 `DepthProfile`, 주요 수심, 시간, 상태 표시처럼 계기성 정보에만 둔다.
- 정보 구조는 `screen header → primary summary group → secondary grouped rows → optional primary action` 순서를 따른다.

watchOS 앱의 기준은 다음과 같다.

- iPhone의 흰 grouped list를 그대로 옮기지 않는다.
- watchOS에서는 black canvas, compact rounded surface, 짧은 label/value, 큰 recording metric 하나를 중심으로 한다.
- recording 화면은 현재 수심, 경과 시간, 상태처럼 즉시 읽어야 하는 정보 하나를 우선한다.
- recording 화면은 왼쪽 full-height depth gauge와 오른쪽 live value 영역을 기본 구조로 삼고, 수심/시간 값을 card 안에 반복 배치하지 않는다.
- Home은 반복 사용자가 바로 시작할 수 있도록 선택 가능한 입력을 dive type 하나로 제한하고, 세부 plan 편집과 모바일 planned dive 선택은 별도 Dive Plan 화면으로 보낸다.
- saved session과 detail 화면은 compact summary, mini profile, 필요한 action 정도만 둔다.

## 상세

### 공통 원칙

- 보더와 장식으로 구분하지 않고 배경, 간격, 타이포 위계로 구분한다.
- 카드 안에 카드를 넣지 않는다.
- 큰 badge나 pill을 화면마다 반복하지 않는다.
- status badge는 낮은 채도와 얇은 강조만 가진 chip이어야 하며, primary-filled button처럼 보이면 안 된다.
- primary blue는 action과 선택 상태의 신호로만 쓴다.
- `success`, `warning` 같은 별도 강조 색을 브랜드 색처럼 쓰지 않는다.
- 큰 graph와 큰 숫자를 한 화면에 여러 개 동시에 두지 않는다.
- safety 관련 copy는 항상 `review`, `reminder`, `non-certified assistant` 범위로 제한한다.

### 모바일 화면 규칙

모바일 화면은 다음 골격을 우선한다.

```txt
[screen padding]
  large title
  short subtitle

  primary summary group
    2-3 key facts
    one mini dive profile

  secondary grouped section
    compact label/value rows

  optional action
    at most one primary button

[tab bar]
```

화면별 역할은 다음처럼 좁힌다.

- Home: 최근 watch dive 하나를 확인하고 Logbook으로 들어가는 시작 화면.
- Logbook: 검색, session list, 선택된 session detail을 한 화면에서 모두 크게 보이게 하지 않는다. list와 detail의 시각 무게를 분리한다.
- Planning: 큰 설명이 아니라 수동 planning reminder 입력 구조를 grouped rows로 보여준다.
- Memory: share preview 하나만 시각적으로 살리고 future workflow나 analytics는 낮은 grouped rows로 축소한다.

구현할 때는 최상위 화면 padding을 공통 `Screen` 또는 native `contentContainerStyle`로 보장한다. `contentContainerClassName`만 믿고 화면 여백을 보장하지 않는다. 화면이 edge에 붙어 보이는 회귀를 막기 위해 padding, section gap, row height는 공통 component에서 관리한다.

### 다이빙 계기 요소

다이빙 앱 고유성은 한 화면의 작은 instrument accent에서 나온다.

- `MiniDepthProfile`은 큰 막대 chart가 아니라 낮고 조용한 sparkline/profile이어야 한다.
- 수심, 경과 시간, rating 같은 수치는 필요한 곳에서만 크게 표시한다.
- temperature profile처럼 보조 정보는 primary profile보다 약한 색과 크기를 쓴다.
- assistant/status copy는 정보 row 안에서 짧게 표시하고, 큰 badge로 반복하지 않는다.
- Sync, demo, safety-stop 상태 chip은 내용의 존재를 알려주는 보조 표식이며 primary action처럼 보이면 안 된다.

### watchOS 번역

watchOS는 같은 제품 언어를 더 압축해서 쓴다.

- 배경은 black canvas를 기본으로 한다.
- surface는 작은 rounded tile 또는 row로 제한한다.
- recording 중에는 한 화면에서 하나의 주요 metric만 강하게 보이게 한다.
- action은 watchOS control 크기에 맞추되, 한 화면에 과도하게 많이 두지 않는다.
- post-dive rating, effort, visibility처럼 1-5 정수 평가를 받는 값은 watch에서 긴 wheel picker보다 짧은 별점 row를 우선한다.
- safety stop, ascent, no-fly 관련 표현은 인증된 판단이 아니라 assistant/reminder 상태로만 둔다.

### 회귀 방지

앞으로 UI를 바꿀 때는 다음 징후가 보이면 이 문서를 다시 참조한다.

- 화면 좌우가 0 padding처럼 보인다.
- 큰 card, 큰 chart, 큰 action button이 한 화면에 모두 있다.
- 같은 session 정보가 여러 card에서 반복된다.
- status pill이 screen title처럼 보인다.
- status chip이 primary button이나 filled action처럼 보인다.
- watchOS 화면이 iPhone grouped list를 축소한 것처럼 보인다.
- watchOS recording 화면이 depth gauge 없이 여러 metric card로만 구성된다.
- 다이빙 안전 기능처럼 읽히는 copy가 생긴다.

## 관련 문서

- [모바일 구조](../architecture/mobile.md)
- [Watch 앱 구조](../architecture/watch-app.md)
- [안전 규칙](../domains/safety-rules.md)
