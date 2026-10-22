# 모바일·워치 UI/UX 개편 설계

## 배경

사용자는 출시해서 반응을 볼 수 있을 만큼 데이터 구조는 갖췄지만, 로그 입력·계획·로그인 UI와 전반적인 완성도가 프로덕션 수준이 아니라고 판단했다. 워치는 수중에서 터치가 막히고 크라운도 쓸 수 없어 사실상 조작할 방법이 없다. 사용자는 UI/UX를 전반적으로 손보되 `DESIGN.md`와 `.wiki/wiki/design/mobile-watch-ui-language.md`의 디자인 규칙을 지키라고 했다. 스켈레톤과 로딩 상태는 `~/Projects/naver-ad-bidder`의 로딩 전략을 그대로 따른다.

판단 근거는 2026-10-22 7개 영역 감사(디자인 규칙, 로딩 전략, 로그인·동의·계정, 로그 입력·상세·목록, 계획·홈·설정, 공통 UI 기반, 워치 UI·수중 조작)다.

## 디자인 기준 (바뀌지 않는 것)

- 모바일은 "iOS grouped base + dive instrument accent"다. `DESIGN.md`의 full-bleed tile은 옮기지 않고 token, weight ladder(300/400/600/700, 500 없음), pill 문법, press `scale(0.95)`, 그림자·장식 그라데이션 금지만 가져온다.
- 화면 골격: 큰 제목 → 핵심 요약 그룹(2-3개 사실 + mini profile 하나) → grouped label/value 행 → 선택적 primary action(최대 하나).
- 보더 대신 배경·간격·타이포로 구분한다. 카드 안에 카드를 넣지 않는다. primary blue는 action과 선택 상태에만 쓴다. status chip은 low-chroma다.
- 안전 문구는 review/reminder/non-certified 범위다. 권장 스탑은 amber caution이고 빨강·필수·required가 아니다. 모르는 값은 0이 아니라 `--`다.
- 워치는 black canvas, compact tile, 녹화 중 큰 metric 하나, 왼쪽 depth gauge + 오른쪽 live value다. 크라운 press는 watchOS Water Lock 동작이며 앱 입력이 아니다.
- 모든 문구는 ko/en 둘 다 둔다. 한국어는 `합니다/세요` 체를 쓰고 `해 주세요`처럼 띄어 쓴다. 권장 스탑 용어는 `권장 스탑`이다.
- 화면 문구는 개발자가 아니라 다이버가 바로 이해하는 말로 쓴다. 동기화 대상, outbox, claim, principal, import, provider, sample, runtime 같은 내부 용어를 화면에 그대로 내보내지 않고, 다이버가 실제로 쓰는 말로 바꾼다. 개념 하나에는 용어 하나만 쓴다. 기준은 `~/Projects/naver-ad-bidder` 위키의 문구 규칙이며, 모바일·워치 전체 문구 감사 결과(용어집과 문구별 수정안)를 적용한다.

## 1. 로딩·스켈레톤 전략 (naver-ad-bidder 이식)

### 상수와 hook

- `apps/mobile/src/constants/async-feedback.ts`: `ASYNC_FEEDBACK_TIMING = { indicator: 1_000, extended: 4_000, longRunning: 10_000 }`, `CONTENT_LOADING_FEEDBACK = { indicatorMs: 1_000 }`. 컴포넌트에 시간을 직접 쓰지 않는다.
- `apps/mobile/src/hooks/use-loading-feedback.ts`: `useLoadingFeedback(isLoading, { indicatorMs?, extendedMs?, longRunningMs?, resetKey?, startedAt? })` → `{ showIndicator, showExtendedFeedback, isLongRunning }`. loading이 false가 되면 같은 render에서 모두 false다. 새 loading은 0부터 다시 잰다. `resetKey`가 바뀌면 다시 잰다. `startedAt`이 있으면 remount 뒤에도 경과 시간을 이어간다. unmount나 입력 변경 때 timer를 정리한다.
- `useContentLoading(active, scope)`: content placeholder 전용. `active`에는 `query.isLoading` 또는 `query.isFetching && !query.data`만 넣는다.
- 컴포넌트별 `setTimeout`, 한 컴포넌트 안의 여러 지연 timer, query wrapper hook은 쓰지 않는다.
- fake timer로 999ms/1000ms, 4s, 10s 경계, 즉시 reset, 0부터 재시작, unmount 정리를 테스트한다.

### 언제 무엇을 보이나

1. 이미 유효한 내용이 보이면 유지한다. 재조회에 스켈레톤을 다시 덮지 않는다.
2. 구조를 예측할 수 있으면 스켈레톤, 아니면 spinner나 progress다.
3. 1초 전에는 아무 표시도 하지 않는다(빠른 작업은 즉시 끝난 것처럼 보인다).
4. 1-4초는 가벼운 표시(스켈레톤 또는 spinner).
5. 4초부터는 멈춘 것처럼 보일 수 있는 곳에만 짧은 문구를 더한다.
6. 10초부터는 재시도·취소·복구 action이나 실제 진행률을 검토한다. 스켈레톤이나 spinner를 영원히 두지 않는다.

- 처음 로드: 지연된 스켈레톤. 백그라운드 재조회: 내용 유지(필요하면 지연된 작은 표시만). 검색·필터·정렬 변경: 이전 데이터 유지.
- 재조회 실패: 마지막 내용을 유지하고 작은 안내를 붙인다("새로 불러오지 못했습니다. 마지막으로 확인한 내용을 표시합니다."). 처음 실패: 스켈레톤 대신 오류와 다시 시도.
- 로딩, 빈 상태, 오류는 서로 다른 상태다. 성공했는데 0건이면 다음 행동이 있는 빈 상태를 보이고 스켈레톤을 보이지 않는다.
- 최소 표시 시간은 없다. content 스켈레톤도 앱 시작 shell도 데이터가 오면 바로 바꾼다(naver의 entry pending과 같다. naver의 500ms 최소 표시는 route 전환 전용이고 이 앱의 native stack 전환에는 해당하는 대기가 없다).

### SkeletonBlock

- `SkeletonBlock`은 처음부터 최종 크기로 mount하되 `opacity: 0`으로 자리를 잡고, 지연 뒤 보이게 한다. 내용이 오면 자리를 그대로 대신해 layout이 밀리지 않는다.
- 정적이다(pulse, shimmer 없음). 접근성에서 숨기고(`accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"`) 탭할 수 없게 한다(`pointerEvents="none"`).
- 색은 새 semantic token `--skeleton`이다. light `232 232 237`(흰 card와 parchment 배경 모두에서 보임), dark `58 58 60`(검은 배경과 card 모두에서 보임). 텍스트 줄은 `rounded`(4px), 아이콘 원은 `rounded-full`, 카드 자리는 실제 카드 radius를 쓴다.
- 스켈레톤은 실제 행·카드의 container, padding, 아이콘 자리, 줄 높이를 그대로 따른다. 제목, 헤더, 사용 가능한 control은 실제로 그리고 데이터 자리만 스켈레톤으로 바꾼다. 일부만 모르면 모르는 칸만 스켈레톤이다.
- 개수: 목록 3행, 페이지 꼬리 2행, 카드 1-2개. 페이지 꼬리 2행은 다음 페이지를 실제로 비동기로 가져오는 동안에만, 미리 잡아 둔 자리에서 `CONTENT_LOADING_FEEDBACK.indicatorMs` 뒤에 보인다.
- 바쁜 영역에는 0ms부터 `accessibilityState={{ busy: true }}`를 둔다. 보이는 spinner에는 현재 언어의 `accessibilityLabel`("…불러오는 중")을 준다.

### 버튼과 저장

- `InstrumentButton`에 `pending`을 더한다. 0ms에 disabled와 `accessibilityState { busy, disabled }`를 켜고 중복 제출을 막는다. 문구는 바꾸지 않는다. 1초가 지나도 진행 중이면 고정된 icon 자리에 `ButtonSpinner`를 보인다(폭 유지).
- 저장 완료는 결과 화면이나 토스트 한 번으로 알린다. 중복 알림을 하지 않는다. 로컬 저장은 "이 기기에 저장했습니다"이며 클라우드 동기화로 표현하지 않는다.
- 닫기, 취소, 관련 없는 action은 전역 busy로 잠그지 않는다. 목록 재조회가 열린 상세나 편집 초안을 닫거나 초기화하지 않는다.

### 앱 시작 shell

- `RecoveryScreen kind="loading"`은 themed app shell이다. 배경과 브랜드를 즉시 그리고(splash와 같은 자리), 1초 뒤 indicator, 4초 뒤 "기록을 준비하는 중" 문구를 보인다. 10초(`isLongRunning`)부터는 "시간이 오래 걸리고 있습니다"와 `다시 시도` action 하나를 보인다. `다시 시도`는 기존 bootstrap 재시도(`retryBootstrap`)에 연결하고, 진행 중인 bootstrap이 있으면 중복 실행하지 않는다. 최소 표시 시간은 없다.

### 워치

- 세션 목록은 동기로 읽으므로 스켈레톤이 필요 없다. Home의 센서 확인은 한 frame 정도(`Task.yield()` 한 번)라 placeholder를 그리면 오히려 깜빡인다. 확인 중에는 실제 시작 카드를 비활성으로 그리고 danger 카드는 숨긴다. placeholder는 쓰지 않는다.
- 다이브 종료 "Saving log" 화면은 즉시 보인다. 저장이 main thread를 잡아 지연 timer가 동작할 수 없기 때문이다. 이것은 "1초 전에는 표시하지 않는다"(규칙 3)의 예외이고, 0ms 응답 규칙과는 맞는다.
- 실시간 수심·시간·상승 값에는 스켈레톤이나 redacted placeholder를 쓰지 않는다. 값이 없으면 `--.- m`과 상태 chip이다.

## 2. 공통 모바일 기반

- token: `--skeleton`(위). tailwind에 `skeleton` 색을 연결한다.
- `Screen`: scroll container, 화면 padding(`px-5 pt-4 pb-6`), safe area, 선택적 refresh. `ScreenHeader`: 큰 제목(`text-3xl font-semibold leading-9`, header role) + trailing action 자리. `Section`: 짧은 header(`text-xs font-semibold uppercase text-muted-foreground`, header role) + `bg-card rounded-2xl` group. `Row`: `min-h-12`, label, value(muted), chevron/check/switch accessory, button role, 행 사이 inset 구분선은 배경 차이로 대신한다.
- `StickyActionBar`: 화면 아래 고정, safe area 위, `bg-background`(불투명), primary pill 하나와 선택적 secondary. 키보드가 열리면 키보드 위에 붙는다.
- 토스트: 한 곳에서 관리하는 `useAppFeedback().notify(message, tone)`. 보더·그림자 없는 `rounded-2xl` 배너이며 하단 tab bar 위에 뜬다. 4초 뒤 자동으로 사라지고 VoiceOver announce를 한 번 한다(iOS에는 polite live region이 없다). action이 없는 결과 알림(저장함, 로그인함, 동기화 요약)만 이것을 쓴다. 로그북 동기화 결과를 이것으로 옮긴다.
- 워치 자동 가져오기 토스트는 `로그 작성` action이 있고 위키 결정(`mobile.md` "사용자가 닫기 전까지 유지")과 테스트가 고정하므로 자동으로 사라지지 않게 그대로 둔다. 모양만 그림자 없는 규칙에 맞춘다.
- 토스트 host(`AppFeedbackProvider`)는 `AccountDataProvider` 위에 둔다. 로그인·로그아웃으로 데이터 소유자가 바뀌면 `AccountDataProvider`가 navigation 전체를 앱 시작 shell로 바꾸기 때문에, host가 그 아래에 있으면 토스트가 함께 사라진다. tab bar 높이는 navigation이 host에 알려 준다.
- tab bar: 아이콘(홈, 로그북, 계획, 설정) 위에 라벨. 선택된 tab만 primary다.
- React Query 기본값: `retry: 1`. 두 번째 실패에서 오류와 다시 시도를 보여 스켈레톤이 오래 남지 않게 한다.
- 데이터 소유자 전환: 지금은 auth `bootstrapping`이 guest로 취급되어, 로그인된 사용자가 앱을 새로 열면 guest 화면이 잠깐 publish된 뒤 다시 shell로 바뀐다. auth가 `bootstrapping`인 동안은 publish를 미루고 shell을 유지한다. 로그인·로그아웃 때 navigation을 유지한 채 skeleton으로 바꾸는 구조 변경은 이전 소유자의 데이터가 섞이지 않게 하는 경계가 커서 이번 범위에서 제외하고, shell 전환을 유지한다.
- 상세·편집 route가 아직 목록 로딩 전이면 "화면을 찾을 수 없음" 대신 공통 상세 스켈레톤(`DetailSkeleton`: 제목 줄, 요약 group, 행 3개)을 보인다.
- `apple-design-system.test.tsx`의 DESIGN.md guard 파일 목록에 새 공통 부품과 편집기 파일을 더하고 `shadow-`를 금지한다.
- `DiveSummaryCard`의 쓰이지 않는 `accent`/`parchment`는 지우거나 실제로 구현한다. 새 카드는 보더·그림자 없는 `rounded-2xl bg-card`다.

## 3. 로그 입력·상세·목록

### 편집기

- 화면 위에 뒤로 버튼과 제목을 두고, 저장은 `StickyActionBar`에 고정한다(`log-entry-editor-save` 유지). 저장 실패는 저장 버튼 바로 위에 보이고 announce한다. 편집기를 열 때 이전 저장 오류를 지운다.
- 순서: **기본**(날짜·시간, 모드, 사이트, 다이브 시간, 최대 수심) → **후기**(별점, 메모) → **세부 정보**(접혀 있음: 입수 방식, 수중 상태, 시야, 운동 강도, 장비, 압력, 버디, 태그, 해양 생물). 세부 정보는 값이 있으면 펼쳐서 연다.
- 숫자 입력: 값 행(label + 값 + chevron)으로 보이고, 값이 없으면 `--:--`, `-- m`, `-- bar`다. 탭하면 bottom sheet에서 wheel 하나와 자주 쓰는 값 chip(시간 30/45/60분, 수심 5/10/18/30 m 등), 직접 입력을 고른다. 선택 값은 지울 수 있다(x). 여러 wheel을 폼 안에 펼치지 않아 스크롤과 값 변경이 섞이지 않는다.
- 날짜·시간: Done이 있는 picker, `maximumDate = now`, 현재 언어 형식으로 표시한다. 새 로그의 기본 시작 시각은 지금이다.
- 워치 기록: 워치가 잰 시작 시각·다이브 시간·최대 수심은 읽기 전용 행과 low-chroma `워치 측정값` chip으로 보인다. `직접 수정`을 누르면 입력이 열리고, `워치 값으로 되돌리기`로 돌아간다. 편집기 eyebrow는 출처에 맞게 `워치 기록`/`직접 작성`이다.
- 워치 가져오기 기본값(사이트 `워치 다이브`, 시작 압력 150 bar)의 저장 방식은 바꾸지 않는다. 이미 저장·동기화된 행이 있고, guest claim 재사용 판정이 `site_name`과 `manual_data`를 정확히 비교하므로 저장값을 바꾸면 같은 워치 세션이 다른 기록으로 판정될 수 있다. 대신 표시만 바꾼다: 출처가 워치이고 사이트가 가져오기 기본값과 정확히 같으면 현재 언어의 `워치 다이브 · 날짜` 대체 제목을 보인다. 저장 기본값 정리는 claim 재사용 검토가 필요한 별도 작업으로 남긴다.
- 텍스트 입력: `returnKeyType`과 다음 칸 이동, 사이트·버디는 단어 첫 글자 대문자, 태그는 자동 대문자 없음. 사이트와 버디는 이전 로그에서 고른 추천 chip을 보인다. badge 입력은 쉼표와 return 둘 다 확정한다.
- 압력은 기록 메타데이터일 뿐이며 잔압·reserve 판단을 하지 않는다.
- `LogbookScreen`과 `PlanningScreen` 안의 화면 내 create/detail/edit route는 앱이 늘 routed 편집기(`onCreateEntry`/`onOpenEntry` 등)를 넘기면 더 이상 쓰이지 않는 경로다. 그렇다면 지우고, 편집기·상세 테스트는 편집기·상세 컴포넌트를 직접 그리는 harness로 옮긴다. 고정된 scroll offset 숫자 대신 측정한 anchor를 기준으로 검사한다. 편집기는 늘 화면 전체의 root라서 sticky 저장 바가 목록 scroll 안에 들어가지 않는다.

### 상세

- 큰 제목과 출처 chip(+ 데모·테스트 기록이면 `데모`/`테스트` chip) → 요약 그룹(최대 수심, 다이브 시간, 수온 중 있는 값 2-3개 + depth profile 하나, 지원 수심 밖 기록이면 low-chroma review 표식) → 워치 기록 group(권장 스탑 상태 pill: `권장 스탑` 문구와 warning tone, 프리다이빙 세션 정보) → grouped 행(모드, 별점 `5점 중 n점`, 입수 방식, 장비, 압력, 버디, 태그, 해양 생물, 메모). 빈 값은 행을 숨긴다. 출처는 한 번만 보이고, 직접 수정한 값에만 표시를 단다. 기존 testID(`log-entry-detail-safety-stop-pill`, `unsupported-depth-warning`, 데모·테스트 chip)는 유지한다.
- 수심은 소수 첫째 자리, 시야·강도는 `3/5`, 압력은 `200 → 50 bar`, 날짜는 올해가 아니면 연도를 붙인다.
- 삭제는 아래쪽 별도 group의 destructive 행이다. 진행 중에는 pending, 실패하면 inline 오류다. 확인 Alert 문구는 유지한다.
- 목록이 아직 로딩 중이면 상세·편집 route는 "화면을 찾을 수 없음" 대신 상세 스켈레톤을 보인다. 로딩이 끝난 뒤에만 찾을 수 없음을 보인다. 워치 profile을 읽는 동안 profile 자리에 스켈레톤을 둔다.

### 목록

- 빈 상태는 직접 작성과 워치 기록을 모두 포함한 문구에 `작성하기`, `워치 동기화` action을 둔다(새 i18n key).
- 스켈레톤은 실제 행 모양(아이콘 원, 두 줄, 오른쪽 값)이다. 개수 줄은 로딩 중에도 자리를 지킨다.
- 페이지 꼬리 표시는 실제 비동기 작업(클라우드 페이지)이 있을 때만, 미리 잡은 자리의 2행 스켈레톤을 1초 뒤에 보인다. 메모리에서 자르는 페이지에는 아무것도 표시하지 않는다.
- 다이브 시간은 `47분`/`47 min`이다. 태그가 없으면 `태그 없음`을 쓰지 않는다. 행 press는 DESIGN.md대로 `scale(0.95)`를 유지한다. 올해가 아니면 연도를 보인다.
- 워치 가져오기와 동기화 결과는 토스트다.

## 4. 계획

- 초안 저장은 가벼운 검증(제목 또는 사이트 하나)이고, `계획으로 정하기`만 전체 검증을 한다. 막히면 빠진 칸을 inline으로 알린다.
- 기존 계획 편집은 `저장` 하나이며 현재 상태를 유지한다. 상태 변경은 상세의 명시 action으로만 한다.
- 상세는 grouped section: 언제·어디서 / 다이브(모드, 입수, 계획 최대 수심, 계획 시간) / 예상 조건(수중 상태, 시야, 난이도) / 사람·장비 / 메모·목표 / 준비 체크리스트. 계획값은 측정값이 아니라 계획으로 표시한다.
- 체크리스트는 탭해서 체크하고 바로 저장한다. 기본 항목은 저장된 영어 문구 대신 `id`로 번역해 보인다. 진행은 `1/3`처럼 조용히 보인다.
- 워치 표시: `계획` 상태만 워치로 보낸다(위키 결정에 코드를 맞춘다. 초안은 보내지 않는다). 상세의 워치 행은 phone이 실제로 아는 값에만 기댄다. planned dive context는 수신 확인이 없는 최신값 전달이므로 "선택 가능"을 확인할 수 없다. 워치로 보낼 대상이고 paired·앱 설치·활성화·`lastContextError` 없음이면 `워치로 보냄`, 보낼 대상인데 연결이 안 되면 `워치 연결 필요`, 초안·완료처럼 보내지 않는 상태면 `iPhone에서만`이다.
- 목록: `다음 다이브` 요약은 다가오는 계획이 있을 때만이다. 4-way 필터와 필터 결과 없음 상태(`모든 계획 보기`)는 위키 규칙과 테스트대로 유지한다. primary action은 `새 계획` 하나다. 날짜가 지난 계획에는 muted `날짜 지남` chip을 붙인다.
- 계획 → 로그: 로그가 있으면 `로그 열기`. 완료로 바꿀 때는 그 자리에서 Alert로 "로그 초안을 지금 만들까요?"를 묻는다.
- 예상 압력은 `예상 시작/종료 압력(메모)`이며 잔압 판단 기준이 아니라고 짧게 적는다.
- 편집기 구조는 로그 편집기와 같다(section, sticky 저장, 값 행 + sheet picker).

## 5. 홈

- 제목과 로그인 링크(Auth가 설정되어 있고 쓸 수 있는 provider가 있을 때만).
- 최근 로그 카드: mini profile 하나와 사실 2개, 데모·테스트 표식과 지원 수심 밖 표식(위키 Home 규칙, `home-latest-demo-badge`, `home-latest-unsupported-depth` 유지). 누르면 상세. 빈 상태는 짧은 문구와 `기록 작성` action.
- `다음 계획` 행(다가오는 계획이 있을 때) → 계획 상세.
- 보조 빠른 action 한 줄: `기록 작성`, `새 계획`. tab bar를 복제하는 큰 버튼 두 개는 없앤다.
- 날씨 카드: 새로고침 중에도 값을 유지하고 버튼 자리에서만 지연된 spinner를 보인다. 새로고침 실패는 마지막 값을 유지하고 작은 안내를 붙인다. `Open-Meteo` 출처를 작게 적는다. 정보 tile은 primary 대신 neutral 배경이다.
- 로그북 읽기 실패는 빈 상태 대신 오류 카드와 다시 시도다. 로딩 중 `0개` 같은 거짓 값을 보이지 않는다.
- 당겨서 새로고침은 로그북과 날씨를 함께 새로 고친다.

## 6. 설정·계정·로그인

- 설정 첫 group은 계정 행이다. 게스트: `로그인`과 한 줄 이점. 로그인: `Apple로 로그인됨`/`Google로 로그인됨`과 chevron → 계정 상세. AuthState에는 provider가 없으므로 이 기기의 `recentProvider`를 힌트로 쓰고, 값이 없으면(재설치 뒤 Keychain 세션 복원 등) `로그인됨`으로 보인다.
- 계정 상세: 동기화 상태, 기기 데이터 가져오기, 로그아웃. 로그아웃은 아래쪽 destructive 행이고, 확인 Alert에서 무엇이 남고 지워지는지(계정 기록은 클라우드에 남고 이 기기의 계정 사본은 지워지며 게스트 기록은 남음)와 아직 보내지 못한 변경이 있으면 그 사실을 알린다. 진행 중에는 pending이다. 계정 삭제는 백엔드가 없어 이번 범위에서 제외한다.
- 알림은 하위 화면 대신 목록 안 스위치다. 테마·언어 선택은 checkmark 하나로만 표시한다. 기기 행은 이름·상태·chevron이다. 정보 group: 앱 버전, 안전 안내(인증된 다이브 컴퓨터가 아님). 행 아이콘은 neutral이다.
- Auth가 설정되지 않은 빌드에서는 로그인 입구(홈·설정)를 숨기고 계정 group은 "이 기기에 저장 중"만 보인다.
- 로그인 sheet: 한 줄 이점(백업, 기기 간 동기화)과 "이 기기의 기록은 직접 가져오기 전까지 유지됩니다"를 보인다. provider 순서(최근 사용 provider 먼저)와 provider 목록 위의 최근 사용 표시는 2026-07-17 로그인 개편 검토 결정대로 유지한다. 버튼은 테마를 따른다(Apple: light 검정/dark 흰색, Google: dark에서 #131314 바탕). 오류는 원인 몇 가지(오프라인, 다른 방법 시도, 서버 문제)로 나누고 announce한다. 버튼 spinner는 지연 규칙을 따른다. sheet는 auth `authenticating` 동안 잠겨 있으므로, 4초부터 "로그인을 확인하는 중입니다", 10초부터 "시간이 오래 걸리고 있습니다. 네트워크 연결을 확인하세요"를 보인다. 진행 중인 교환을 취소하려면 auth 상태 변경이 필요해 이번 범위에서 제외한다.
- 필수 동의: grouped list에 `모두 동의` 행, `[필수] 이용약관`, `[필수] 개인정보 처리방침` 행(체크 + 보기 chevron), 시행일 표시, 고정된 아래쪽 동의 버튼(pending), 취소는 header 텍스트 버튼. 문서를 불러오지 못하면 다시 시도할 수 있다.
- 기기 데이터 가져오기 sheet: 가져오기와 기기에 유지가 무엇인지 두 줄로 설명하고, 오프라인이면 이유를 적는다. 개수는 보간 문구(`다이빙 로그 {{count}}개`)다. CTA는 `InstrumentButton`이다.
- 로그인하면 토스트 "로그인했습니다"를 한 번 보인다. 로그인으로 데이터 소유자가 바뀌면 navigation이 shell로 교체되어 sheet가 "닫히는" 순간이 없으므로, `AccountDataProvider` 위에서 auth가 `authenticated`로 바뀌는 전환을 보고 알린다(세션 복원은 알리지 않는다).

## 7. 워치 수중 조작과 화면

### 입력 모델

- 터치: 대기, Wet Ready, 요약에서만 주 입력이다. 실제 녹화 중에는 터치로 종료하지 않는다(종료 화면에도 탭 대상이 없다). Water Lock이 녹화 중 늘 켜져 있다는 전제는 실기기 확인 전이다.
- 실제 녹화 중: Action Button 한 번 누르기가 기본 입력, 크라운 회전은 보조 입력(Water Lock 중 앱에 오는지 실기기 확인 전), 단계별 자동 화면 전환이 나머지를 맡는다. 크라운 press는 쓰지 않는다.
- Action Button은 하나의 단계 인식 intent로 바꾼다. 모든 시작 경로(Action Button, Home 수동 시작, watchOS 자동 실행)가 같은 intent로 이어진다: `StartDiveIntent`의 result와 `DiveActionButtonDonor`의 donation 모두 이 intent를 돌려주고, 이 intent는 다이브가 끝날 때까지 자기 자신을 돌려준다. donor 기본값, XCTest, `watch-app.md`의 설명을 함께 바꾼다.
  - 대기, Wet Ready, 요약 화면: 누르면 시작(지금과 같음).
  - 물속 녹화: 누르면 다음 화면(Live → 세부 → Live). 10초 동안 누르지 않거나 단계가 바뀌면(프리다이빙 하강·수면, 권장 스탑 시작) Live로 돌아간다. 수심 신호가 live에서 stale·sensorError·beyondSensorRange로 바뀌어도 바로 Live로 돌아간다.
  - 수면, 3분 미만: 누르면 다음 화면이고, 안내에 종료까지 남은 시간을 보인다.
  - 수면, 종료 가능: 화면 순환 끝에 `종료하고 저장` 화면이 생긴다. 그 화면에서 누르면 기존 종료 경로(물 밖 + 180초 guard 그대로)를 탄다. 종료는 늘 두 번 이상의 의도된 누르기다. `minimumHardwareEndElapsedSeconds = 180`과 그 guard pin은 바꾸지 않는다.
  - 거부된 누르기는 조용히 넘기지 않고 햅틱과 짧은 안내를 보인다.
- 크라운 회전은 같은 화면 index를 움직인다. 종료에는 연결하지 않는다.
- Demo·debug 흐름은 지금처럼 크라운으로 수심을 흉내 내고 자체 종료 경로(toolbar xmark와 override)를 유지한다. 화면 순환은 실제 녹화에만 적용한다.
- 햅틱은 사용자가 한 조작의 확인에만 쓴다: 시작, 사용자가 일으킨 화면 전환(Action·크라운), 거부, 종료 요청, 저장 완료. 자동 전환(10초 복귀, 프리다이빙 하강·수면, 권장 스탑 시작, 수심 신호 변화, Always-On 진입)은 햅틱 없이 화면만 바꾼다. 권장 스탑 상태가 바뀌어도 햅틱이 없음을 테스트한다. 센서 오류·권장 스탑·상승과 연결된 햅틱은 안전 규칙상 사용자 검토가 필요하므로 이번에 넣지 않는다.
- Action Button 유무와 Divenary 지정 여부를 알려 주는 공개 API는 없다. 모델 식별자(`hw.machine`, 시뮬레이터는 `SIMULATOR_MODEL_IDENTIFIER`)로 Ultra 계열인지 힌트만 얻는다(식별자 목록은 실기기 확인 대상). Ultra 계열이 아니면 `Action ▸` 안내를 숨기고 크라운·Water Lock 안내로 대신한다. Ultra 계열이어도 지정 여부는 모르므로 문구는 조건형("Action Button에 Divenary를 지정했다면 …")이고, Home 설정 안내로 이어진다.

### 화면

- 녹화 화면 아래 고정 2줄 안내 대신 단계에 맞는 한 줄 안내 chip: 물속 `Action ▸ 세부 1/2`, 수면 3분 미만 `종료 가능까지 m:ss`, 종료 가능 `Action ▸ 종료 화면`, 종료 화면 `눌러서 종료하고 저장`. Water Lock 안내는 수면에서만 보인다. Action Button이 없는 기기는 같은 자리에 크라운 안내를 쓴다.
- 모든 녹화 화면(세부 포함)은 왼쪽 depth gauge, `LiveReadoutStatusRow`(수심 상태 chip과 Demo/Test 표식), `UnsupportedDepthWarning`을 유지한다. 큰 metric은 하나다: live 수심(`liveDepthSignal == .live`일 때만), 아니면 경과 시간.
- 세부 화면은 이미 publish된 값만, 보조 값은 두 개까지 쓴다. 스쿠버: 최대 수심, 수온. 프리다이빙(세션): 큰 값은 다이브 수, 보조 값은 마지막 다이브(시간·수심), 가장 긴 다이브. 평균 수심은 recorder가 실시간으로 publish하지 않아 넣지 않는다. 상승 참고값은 안전 검토가 필요해 넣지 않는다. 페이지 점을 보인다.
- 큰 metric 가독성: 단위를 작은 별도 Text로 나누고 숫자는 rounded design + `monospacedDigit`로 그린다. depth gauge 폭을 줄여 숫자 자리를 넓힌다.
- Always-On(`isLuminanceReduced`): Live 화면으로 돌아가고 흰 숫자, 외곽선 gauge, 보조 숫자만 숨긴다. Live 상태별로 정한다: 일반은 수심·시간, 권장 스탑은 `권장 스탑` 라벨을 남기고 일시정지 상태도 구별되게 한다(amber는 어두워져도 라벨은 남는다). 어떤 Always-On 상태에서도 수심 상태 chip과 Demo/Test 표식은 숨기지 않는다.
- Wet Ready: auto-launch 상태(켜짐/꺼짐/모름)와 Action Button 힌트에 따라 "watchOS가 다이브 세션을 시작하면 기록됩니다" / "Action Button에 Divenary를 지정했다면 눌러서 기록을 시작합니다" / "물에 들어가기 전에 Home에서 시작하세요"를 보인다. 상태를 모르면 마지막 문구를 쓴다. 모드와 크라운 선택을 주 요소로 둔다.
- Home: 센서 확인 중에는 실제 시작 카드를 비활성으로 그린다(빨간 카드 없음, placeholder 없음). `수중 조작` 행 → 설정 안내 화면(Auto-Launch 상태, Action Button 지정 방법, 크라운 안내). Demo 카드는 아래쪽 보조 행으로 내린다.
- 요약: 최대 수심과 시간을 먼저, sample 수는 상세로, 상태는 한 곳에, 저장 완료 햅틱, Action Button 힌트가 있으면 `Action ▸ 다음 다이브 시작` 안내.
- 표시 오류: `diveCount/#`, 빈 제목 metric 같은 문구 버그를 고친다. `Ultra required`는 `Depth-capable Apple Watch required` 성격으로 바꾼다. 한국어 `권장 스톱`은 `권장 스탑`으로 맞춘다.

## 검증과 남는 일

- `yarn mobile:typecheck`, `yarn mobile:test`, `yarn mobile:lint`, `yarn watch:ui:check`, `yarn watch:build`, 워치 XCTest, iPhone 17 Pro 시뮬레이터에서 화면 확인.

### 의도적으로 바꾸는 테스트 pin

아래 pin은 이 설계가 일부러 뒤집는 동작이다. 해당 UI 변경과 같은 변경에서 새 기대값으로 고치고, 위키에서 온 결정이면 위키도 함께 고친다. 실패가 이 목록에 없으면 회귀로 본다.

- 홈 날씨: 새로고침 중 스켈레톤·즉시 spinner(`home-conditions.test.tsx`) → 값 유지, 버튼 자리 지연 spinner(fake timer 999/1000ms). `Open-Meteo` 출처 문구가 새로 생긴다.
- 홈 action: 큰 버튼 두 개(`home-open-planning-action` 등, `App.test.tsx`) → 보조 빠른 action과 `다음 계획` 행.
- 로그인 입구: Auth 미설정에서도 보이던 `home-login-action`(`App.test.tsx`) → Auth가 설정된 빌드에서만.
- 로그북 목록: 메모리 페이지의 `logbook-loading-more` footer(`logbook-manual-entry.test.tsx`) → 표시 없음. 실제 비동기 페이지만 지연된 2행 꼬리 스켈레톤.
- 소셜 로그인: 즉시 spinner(`social-login-button.test.tsx`, `auth-screens.test.tsx`) → 0ms busy/disabled, 1초 뒤 spinner.
- 편집기: 고정 scroll offset(`logbook-manual-entry.test.tsx`의 `'470'`, `App.test.tsx`의 `'314'`)과 화면 내 편집기 harness → 측정 anchor, 직접 그리는 harness.
- 워치 녹화: 고정 footer 문구 'End with the configured Action Button or by turning off Water Lock.'(`watch-connectivity-native-source.test.ts`)와 `footerHint` 9pt 규칙(`check-watch-ui-language.mjs`) → 단계별 안내 chip 규칙.
- 워치 Home: `trailingSystemImage: "play.fill"` 정확히 3개와 Demo `StartSessionCard`(`check-watch-ui-language.mjs`, jest) → 시작 카드 2개 + Demo 보조 행. 센서 확인(`readiness != .ready`, `launchPlaceholder`, `Task.yield`) pin → 비활성 카드 규칙.
- 워치 Action Button: End intent donation과 donor XCTest → 단계 인식 intent.
- 바꾸지 않는 pin: `minimumHardwareEndElapsedSeconds = 180`과 guard 정규식, 금지 문구, 권장 스탑 amber·문구, Demo/Test 표식, `--` 표시, 계획 필터 결과 없음 상태, 워치 자동 가져오기 토스트가 timer로 닫히지 않는다는 테스트.
- 실기기에서만 확인할 수 있는 것(Action Button 순환, 크라운 회전이 Water Lock 중 앱에 오는지, 햅틱 체감, Always-On 갱신 주기, 41/46/49mm 배치)은 통과로 보고하지 않고 기기 체크리스트에 남긴다.
- 계정 삭제(백엔드 필요), 센서 오류·권장 스탑 햅틱(안전 검토 필요), 다이브 중 순간 표시(contract 변경 필요)는 이번 범위 밖이다.
- 위키(`mobile-watch-ui-language.md`, `watch-app.md`, `mobile.md`, 필요하면 `safety-rules.md`)에 로딩 전략, 수중 입력 모델, 녹화 안내 chip 규칙, 워치 Home Demo 보조 행, 토스트 규칙을 기록한다.
- 이번 범위 밖으로 남기는 것: 로그인·로그아웃 때 navigation을 유지하는 데이터 소유자 전환, 로그인 교환 취소, 워치 가져오기 저장 기본값 정리(claim 재사용 검토 필요), 워치 계획 수신 확인(contract 변경 필요).
