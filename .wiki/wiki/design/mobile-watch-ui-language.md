# Mobile/Watch UI 언어

Sources: pre-Karpathy wiki page, 2026-06-28; Diving App repository implementation, 2026-07-07; user requested depth/safety stop/deco pending work, 2026-07-08; pre-device depth safety sync readiness implementation, 2026-07-09; pre-real-dive readiness scope and immediate hardening, 2026-07-12; Mobile claim bootstrap and theme recovery, 2026-07-22; 2026-10-21 프로젝트 리뷰 후속 수정 경계, 2026-10-21; 2026-10-22 모바일·워치 UI/UX 개편, 2026-10-22
Raw: [Pre-Karpathy: Mobile/Watch UI 언어](../../raw/design/mobile-watch-ui-language.md); [Watch debug demo sync logbook UX](../../raw/architecture/2026-07-07-watch-debug-demo-sync-logbook-ux.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md); [Pre-device depth safety sync readiness](../../raw/decisions/2026-07-09-pre-device-depth-safety-sync-readiness.md); [Pre-real-dive readiness scope and immediate hardening](../../raw/architecture/2026-07-12-pre-real-dive-readiness.md); [Mobile claim bootstrap and theme recovery](../../raw/architecture/2026-07-22-mobile-claim-bootstrap-theme-recovery.md); [2026-10-21 프로젝트 리뷰 후속 수정 경계](../../raw/architecture/2026-10-21-review-remediation.md); [2026-10-22 모바일·워치 UI/UX 개편](../../raw/design/2026-10-22-ui-ux-overhaul.md)
Updated: 2026-10-22

## 요약

`diving-app`의 모바일과 watchOS UI는 **iOS grouped base + dive instrument accent**를 공통 방향으로 삼는다. 현재 watch recording은 full-height depth gauge와 compact live values를 중심으로 한다. 모바일 cloud 상태는 backend가 없을 때 숨기고, 실제 상태가 생긴 뒤에만 low-chroma badge를 사용한다. Safety stop 권장 상태와 future mandatory/decompression 상태는 색상 severity를 분리한다.

2026-10-22 개편부터 화면 문구는 다이버가 자연스럽게 읽는 말로 쓰고 개발자·시스템 용어를 화면에 내보내지 않으며, 개념 하나에는 용어 하나만 쓴다. 로딩 표시는 naver-ad-bidder 전략을 따라 1초 전에는 아무것도 보이지 않고, 1초부터 실제 모양의 정적 스켈레톤이나 spinner, 4초부터 짧은 문구, 10초부터 재시도를 보인다. 워치 실제 기록은 동작 버튼 한 번 누르기와 크라운 회전으로 화면을 넘기고, 다음 누르기가 무엇을 하는지 한 줄 안내 chip으로 알린다.

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
- Home은 프리다이빙·스쿠버 시작 카드 두 개를 주 요소로 두고, 모바일 계획 선택은 다이빙 계획 행으로, Demo는 아래쪽 보조 행으로 보낸다.
- saved session과 detail 화면은 compact summary, mini profile, 필요한 action 정도만 둔다.

## 상세

### 공통 원칙

- 보더와 장식으로 구분하지 않고 배경, 간격, 타이포 위계로 구분한다.
- 카드 안에 카드를 넣지 않는다.
- 큰 badge나 pill을 화면마다 반복하지 않는다.
- status badge는 낮은 채도와 얇은 강조만 가진 chip이어야 하며, primary-filled button처럼 보이면 안 된다.
- 40m 초과 unsupported-depth marker는 낮은 채도의 review warning으로 표시하고, critical alarm이나 수중 행동 지시처럼 보이면 안 된다.
- primary blue는 action과 선택 상태의 신호로만 쓴다.
- `system` appearance는 별도 light/dark 값으로 복사해 저장하지 않고 OS appearance를 따르는 override 해제 상태로 유지한다. Native navigation, modal, form sheet의 uncovered area까지 같은 semantic background를 명시한다.
- 복구 UI는 앱을 가리는 장기 blank 화면 대신 themed loading shell, compact Home banner, 단일 retry action을 사용한다. 시작 shell은 배경과 브랜드를 바로 그리고 10초에 오래 걸린다는 문구와 다시 시도를 보인다. 데이터 삭제, 저장소 초기화, 자동 로그아웃을 복구 action으로 제시하지 않는다.
- `success`, `warning` 같은 별도 강조 색을 브랜드 색처럼 쓰지 않는다.
- 큰 graph와 큰 숫자를 한 화면에 여러 개 동시에 두지 않는다.
- safety 관련 copy는 항상 `review`, `reminder`, `non-certified assistant` 범위로 제한한다.
- v1 safety stop 권장은 보조 caution tone으로 표시하고, mandatory/decompression stop 같은 future 필수 상태와 같은 색상이나 위계로 표시하지 않는다.
- 모바일 `StatusPill`의 `warning` tone은 amber `--warning` token을 쓴다. 권장 스탑 미완료·일시정지, 동기화 부분 실패처럼 확인이 필요한 상태에만 쓰고, 오류·위험은 `danger`(destructive), 완료와 정상은 primary 또는 muted로 둔다. 권장 스탑 미완료를 빨강으로 표시하지 않는다.
- 되돌릴 수 없는 삭제는 시스템 Alert로 확인하고, 함께 지워지는 대상(Watch 원본, 다른 기기 사본)을 알린다. 수정 중인 편집 화면을 벗어날 때는 변경 폐기를 확인한다.
- 목록은 조회 실패(다시 시도), 검색·필터 결과 없음(검색어 지우기·모든 계획 보기), 처음부터 빈 상태를 서로 다른 문구와 action으로 구분한다.
- 그림자와 장식 그라데이션을 쓰지 않는다. 새 카드는 보더·그림자 없는 `rounded-2xl bg-card`이고, 누르는 행과 버튼은 `scale(0.95)`로 반응한다. 글꼴 굵기는 300/400/600/700만 쓰고 500(medium)은 쓰지 않는다.

### 화면 문구

- 화면 문구는 다이버가 자연스럽게 읽는 말로 쓴다. 동기화 대상, outbox, claim, principal, import, provider, sample, runtime, session, guest 같은 개발자·시스템 용어는 화면과 접근성 문구에 내보내지 않는다. 오류 코드나 원본 오류 문자열도 화면에 그리지 않는다.
- 개념 하나에는 용어 하나만 쓴다. 기준 용어는 다이빙 기록(기록)/Dive log, 다이빙/Dive, 다이빙 시간/Dive time, 다이빙 포인트/Dive site, 다이빙 종류/Dive type, 수심 그래프/Depth chart, 워치 기록 가져오기/Get watch logs, 다시 보내기/Send again, iPhone에 저장됨/Saved on iPhone, 로그인 전 기록/Records made before sign-in, 계정으로 옮기기/Move to account, 기록 백업/Backup, 이 기기에만 저장, 수중 상태/Water conditions, 호흡 기체/Breathing gas, 훈련 목표/Training goal, 로그인/Sign in, 권장 스탑/Recommended stop, 스탑 구간/Stop zone이다.
- 스쿠버 압력은 탱크 압력/Tank pressure, 시작 압력/Start pressure, 종료 압력/End pressure다. 시작 값에 `잔압`을 쓰지 않는다. 계획의 예상 압력은 `탱크 압력 메모` 아래에 두고 탱크 압력 판단 기준이 아니라고 적는다.
- 워치 한국어는 동작 버튼/Action Button, 수중 잠금/Water Lock을 쓰고, 크라운은 문장에서 `디지털 크라운`, 짧은 chip에서 `크라운 ▸`로 쓴다. 한국어 권장 스탑은 `스탑`으로 쓰고 `스톱`, `세이프티`를 쓰지 않는다.
- 문장은 대상 → 확인된 상태 → 필요한 행동 순서로 쓴다. 확인된 원인만 말하고, 실제로 가능한 복구 행동만 안내하며, 버튼은 실제 행동과 범위를 말한다. 저장 위치와 전송 방향(워치 → iPhone 저장과 계정 백업)을 섞지 않고, 전송 요청을 상대 기기의 수신 확인처럼 쓰지 않는다.
- 한국어는 `합니다/세요` 체로 쓰고 `해 주세요`처럼 띄어 쓴다. 영어는 sentence case다.
- 모르는 값은 `--`다. 단위를 가진 자리는 `-- m`, `-- bar`, `--분`처럼 단위를 남기고, 워치 실시간 값은 `--.- m`와 상태 chip을 쓴다. 0이나 정상 상태로 채우지 않는다.
- 문구를 줄이더라도 Demo/Test 표식, 지원 수심 밖 표식, 비인증 안내는 지우지 않는다.
- 실제 문구의 기준은 모바일 `apps/mobile/src/i18n/resources.ts`와 워치 `Localizable.xcstrings`다. 설계 문서에 따옴표로 적힌 화면 문구는 초안이다. `i18n.test.ts`와 `check-watch-ui-language.mjs`가 금지 용어, 권장 스탑 표기, 영어 단수·복수 key를 검사한다.

### 로딩과 피드백

naver-ad-bidder의 로딩 전략을 그대로 따른다. 시간 값은 `src/constants/async-feedback.ts`의 `ASYNC_FEEDBACK_TIMING`(indicator 1초, extended 4초, longRunning 10초)과 `CONTENT_LOADING_FEEDBACK`에만 두고, 화면은 `useLoadingFeedback`(`showIndicator`, `showExtendedFeedback`, `isLongRunning`)으로 읽는다. 컴포넌트마다 timer를 따로 두지 않는다.

- 1초 전에는 아무것도 보이지 않는다. 1-4초는 스켈레톤 또는 spinner, 4초부터는 멈춘 것처럼 보일 수 있는 곳에만 짧은 문구를 더하고, 10초부터는 재시도·복구 action이나 실제 진행률을 보인다. 스켈레톤이나 spinner를 끝없이 두지 않는다.
- 최소 표시 시간은 없다. 내용 스켈레톤과 앱 시작 shell 모두 데이터가 오면 바로 바뀐다.
- 구조를 예측할 수 있으면 스켈레톤, 아니면 spinner다. `SkeletonBlock`은 처음부터 최종 크기로 자리를 잡고 지연 동안 보이지 않다가 나타나며, 정적(pulse·shimmer 없음)이고 접근성에서 숨고 탭할 수 없다. 색은 `--skeleton` token이다. 호출자의 크기·radius class는 `cn`으로 합쳐 기본값을 대신한다.
- 스켈레톤은 실제 행·카드의 container, padding, 아이콘 자리, 줄 높이를 따른다. 제목, 헤더, 쓸 수 있는 control은 실제로 그리고 데이터 자리만 비운다. 목록은 3행, 페이지 꼬리는 2행, 카드는 1-2개다. 페이지 꼬리 스켈레톤은 클라우드 페이지처럼 실제로 비동기로 가져오는 동안에만 보이고, 메모리에서 자르는 페이지에는 표시하지 않는다.
- `useContentLoading`은 현재 범위에 유효한 내용이 아직 없는 읽기에만 쓴다. 이미 보이는 내용은 재조회 중에도 유지한다. 재조회 실패는 마지막 내용을 유지하고 작은 안내를 붙이며, 처음 불러오기 실패는 오류와 다시 시도다. 성공한 0건은 다음 행동이 있는 빈 상태이고, 로딩 중에 `0개` 같은 값을 보이지 않는다.
- 바쁜 영역은 0ms부터 `accessibilityState.busy`를 갖고, 보이는 spinner는 현재 언어의 라벨을 갖는다.
- `InstrumentButton`의 `pending`, grouped-list `Row`의 `pending`, `ListStateCard`의 `actionPending`은 0ms에 disabled·busy가 되어 중복 실행을 막고, 1초가 지나도 진행 중이면 고정된 자리에 spinner를 보인다. 버튼 문구는 바꾸지 않는다. 닫기, 취소, 관련 없는 action은 잠그지 않는다.
- 완료는 결과 화면이나 배너 한 번으로 알린다. 로컬 저장은 이 기기에 저장했다고 쓰고 계정 백업으로 표현하지 않는다.
- 결과 배너는 `useAppFeedback().notify(message, tone)` 하나로 띄운다. 보더·그림자 없는 `rounded-2xl` 배너가 tab bar 위에 뜨고, 4초 뒤 사라지며, VoiceOver에 한 번 알린다(iOS에는 polite live region이 없다). action이 없는 결과(저장함, 로그인함, 워치 기록 가져오기 결과)에만 쓴다.
- 워치 자동 가져오기 토스트는 `기록 보기` action이 있어 다이버가 닫을 때까지 남는다. 반전된 표면(`bg-foreground`)을 쓰고, 결과 배너는 그 위에 쌓인다.
- 워치는 저장 세션 목록을 동기로 읽어 스켈레톤이 없다. Home 센서 확인 중에는 placeholder 대신 실제 시작 카드를 비활성으로 그린다. 다이브 종료의 저장 중 화면은 즉시 보인다(저장이 main thread를 잡아 지연 timer가 동작할 수 없는 예외다). 실시간 수심·시간·상승 값에는 스켈레톤이나 redacted placeholder를 쓰지 않는다.

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

- Home: 큰 제목과 로그인 링크(Auth가 설정되어 있고 쓸 수 있는 로그인 방법이 있는 guest일 때만), 기록 개수 한 줄, 최근 기록 카드(mini profile 하나와 최대 수심·다이빙 시간, 데모·테스트와 지원 수심 밖 표식), 다가오는 계획이 있을 때만 `다음 다이빙` 행, 보조 빠른 action 한 줄(기록 작성, 계획 만들기), 날씨 카드 순서다. tab bar를 복제하는 큰 버튼은 두지 않는다. 최근 기록 카드는 처음 불러오기 스켈레톤, 처음 실패의 오류 카드와 다시 시도, 재조회 실패 안내, 빈 상태를 구분한다. 날씨 카드는 새로고침 중에도 값을 유지하고 버튼 자리에서만 1초 뒤 spinner를 보이며, 실패하면 마지막 값에 안내를 붙이고, 작은 `Open-Meteo 데이터` 출처를 적는다. 정보 tile은 neutral 배경이고, 당겨서 새로고침은 기록과 날씨를 함께 새로 고친다.
- Logbook: 목록 행은 보더 없는 `rounded-2xl bg-card px-4 py-3` 카드 하나다. 왼쪽 neutral 출처 아이콘, 첫 줄은 제목과 오른쪽 최대 수심, 둘째 줄은 `날짜 시간 · 다이빙 종류 · 다이빙 시간(47분)`이고, 태그 줄은 다이버가 직접 단 태그가 있을 때만, 표식 줄은 데모·테스트·이 기기에만 저장·지원 수심 밖이 있을 때만 보인다. 올해가 아니면 연도를 붙이고 `태그 없음`은 쓰지 않는다. 행마다 접근성 라벨 하나에 제목, 날짜, 표식, 수치를 담는다. 빈 상태는 직접 작성과 워치 기록을 모두 말하고 `기록 작성`, `워치 기록 가져오기` action을 둔다. 개수 줄은 로딩 중에도 자리를 지키고, 처음 불러오기 실패 때는 비운다.
- Planning: 헤더의 primary action은 `계획 만들기` 하나다. 다가오는 계획이 있을 때만 `다음 다이빙` 행을 두고, 4-way 필터와 필터 결과 없음 상태(`모든 계획 보기`)를 유지한다. 행 chip은 초안, 완료됨, 날짜 지남일 때만 muted로 붙는다. 상세는 언제·어디서, 다이빙, 압력 메모, 예상 조건, 사람·장비, 메모·목표, 준비 체크리스트 grouped section이며 계획값은 측정값이 아니라 계획으로 표시한다.
- Settings: 첫 group은 계정 행이다. guest는 `로그인`과 한 줄 이점, 로그인 상태는 `Apple로 로그인됨`/`Google로 로그인됨`(이 기기의 최근 provider 힌트, 없으면 `로그인됨`)과 계정 상세 chevron이다. Auth가 설정되지 않았거나 쓸 수 있는 로그인 방법이 없으면 `이 기기에만 저장`만 보인다. 알림은 목록 안 스위치, 테마·언어는 checkmark 하나로 표시하고, 정보 group에 앱 버전과 비인증 안내를 둔다. 행 아이콘은 neutral이다.
- Memory: share preview 하나만 시각적으로 살리고 future workflow나 analytics는 낮은 grouped rows로 축소한다.

편집기·상세 화면은 다음 패턴을 따른다.

- 편집기는 화면 전체의 root다. 위에 뒤로 버튼과 제목을 고정하고 저장은 아래 `StickyActionBar`에 고정한다. 저장 실패는 저장 버튼 바로 위에 보이고 VoiceOver에 알리며, 편집기를 열 때 이전 저장 오류는 보이지 않는다. 키보드가 열리면 저장 바와 초점을 받은 입력이 가려지지 않게 한다. 오류로 이동할 때는 고정 scroll 숫자가 아니라 측정한 anchor를 쓴다.
- 로그 편집기 section은 기본(날짜·시간, 다이빙 종류, 다이빙 포인트, 다이빙 시간, 최대 수심) → 후기(별점, 메모) → 세부 정보다. 세부 정보는 접혀 있다가 값이 있거나 첫 오류가 그 안에 있으면 펼쳐진다. 계획 편집기도 같은 구조(section, 고정 저장 바, 값 행)다.
- 숫자 입력은 label·값·chevron이 있는 값 행이고, 비어 있으면 `--:--`, `-- m`, `-- bar`다. 탭하면 bottom sheet에서 wheel 하나, 자주 쓰는 값 chip, 직접 입력, 지우기, Done을 고른다. 폼 안에 여러 wheel을 펼치지 않아 스크롤과 값 변경이 섞이지 않는다. 압력에는 chip을 두지 않아 어떤 숫자도 권장 잔량처럼 보이지 않는다.
- 날짜·시간은 Done이 있는 sheet picker다. 로그 편집기는 미래 시각을 고를 수 없고(`maximumDate`가 현재 시각), 계획 편집기에는 이 제한이 없다. 현재 언어 형식으로 보이고, 올해가 아니면 연도를 붙인다.
- 워치 기록의 시작 시각·다이빙 시간·최대 수심은 읽기 전용 행과 low-chroma `워치 측정값` chip으로 보인다. `직접 수정`을 누르면 입력이 열리고 `워치 값으로 되돌리기`로 돌아간다. 편집기 eyebrow는 출처에 따라 `워치 기록`/`직접 작성`이다.
- 사이트·버디는 이전 기록의 추천 chip을 보이고, 태그 입력은 쉼표와 return으로 확정한다.
- 상세는 큰 제목, 출처 chip 하나(+데모·테스트 chip), 날짜 → 요약 group(있는 값 2-3개와 수심 그래프 하나, 지원 수심 밖 review 표식) → 워치 기록 group(권장 스탑 pill, 프리다이빙 정보) → 빈 값은 숨긴 grouped 행 순서다. 형식은 수심 소수 첫째 자리, `3/5`, `200 → 50 bar`, `5점 중 n점`이다. 출처는 한 번만 보이고 직접 수정한 값에만 표시를 단다.
- 삭제와 로그아웃은 아래쪽 별도 group의 destructive 행(`Row` pending)이다. 진행 중에는 busy, 실패하면 inline 오류와 VoiceOver 알림이다. 확인 Alert는 유지한다.
- 상세·편집 route가 목록 로딩 전이면 `DetailSkeleton`(제목 줄, 요약 group, 행 3개)을 보이고, 목록 조회가 실패하면 오류와 다시 시도를 보인다. "화면을 찾을 수 없음"은 목록이 성공적으로 불러졌는데 항목이 없을 때만이다.

로그인과 계정 화면은 다음을 따른다.

- 로그인 sheet는 한 줄 이점(기록 백업, 다른 기기에서 보기)과 로그인 전 기록은 계정으로 옮길지 직접 고를 수 있다는 안내를 보인다.
- Apple과 Google 버튼은 한 쌍으로 그린다. 같은 50pt pill, 같은 라벨 크기(17/22), 같은 로고 자리를 쓰고, 극성은 각 브랜드 팔레트에서 같게 고른다. 밝은 sheet에서는 Apple 검정과 Google `#131314` 어두운 테마, 어두운 sheet에서는 Apple 흰색과 Google 밝은 테마다.
- 마지막으로 쓴 provider를 먼저 두고 버튼 모서리에 작은 최근 사용 표시를 단다. 2026-10-22 소유자 요청이 2026-07-17 로그인 개편의 "provider 목록 위 최근 사용 라벨" 결정을 대체한다.
- 로그인 오류는 오프라인, 다른 방법 시도, 서버 문제, 일반 오류로 나눠 VoiceOver에 알리고 원본 오류를 그리지 않는다. 버튼 spinner는 1초 지연을 따르고, 토큰 교환 중에는 4초에 확인 중 문구, 10초에 네트워크 확인 문구를 한 번씩 알린다. Apple·Google 화면이 열려 있는 동안에는 이 문구를 띄우지 않는다.
- 필수 동의 화면은 grouped list의 `모두 동의` 행, `[필수]` 문서 행(체크와 보기), 시행일, 아래 고정 동의 버튼(pending), header 취소 버튼이다.

구현할 때는 최상위 화면 padding을 공통 `Screen` 또는 native `contentContainerStyle`로 보장한다. `contentContainerClassName`만 믿고 화면 여백을 보장하지 않는다. 현재 Home, Planning, Settings는 React Native `ScrollView`의 `contentContainerClassName`을, Logbook은 고정 헤더 아래 `FlatList`의 `contentContainerClassName`을 쓰고 NativeWind가 이를 `contentContainerStyle`로 바꾼다. 다른 scroll container를 쓰면 이 변환이 되는지 먼저 확인한다. 화면이 edge에 붙어 보이는 회귀를 막기 위해 padding, section gap, row height는 공통 component에서 관리한다.

### 다이빙 계기 요소

다이빙 앱 고유성은 한 화면의 작은 instrument accent에서 나온다.

- `MiniDepthProfile`은 큰 막대 chart가 아니라 낮고 조용한 sparkline/profile이어야 한다.
- 수심, 경과 시간, rating 같은 수치는 필요한 곳에서만 크게 표시한다.
- temperature profile처럼 보조 정보는 primary profile보다 약한 색과 크기를 쓴다. 수온 그래프는 muted neutral 색이며, amber `warning` token은 권장 스탑 같은 확인 필요 상태에만 남긴다.
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
- 권장 스탑은 진행·일시정지·미완료 모두 `DiveWatchTheme.caution` 앰버와 "Recommended stop"(권장 스탑) 문구를 쓰고, 완료는 보조 회색이다. 일시정지는 색만이 아니라 `타이머 일시정지` 문구로도 구별한다. 실시간 수심이 현재 값이 아니면 숫자 대신 `--.- m`와 짧은 상태 chip을 보인다.
- 계획 목록은 Home에 펼치지 않고 다이빙 계획 화면 한 행으로 들어간다. 저장 기록의 전송 상태는 iPhone 전송 대기, iPhone에 저장됨, iPhone 전송 실패처럼 무엇이 일어나는지로 표시하고, 실패한 기록 상세에만 `다시 보내기`를 둔다. 지원 수심을 넘은 기록에는 `지원 수심 밖` 표식을 붙인다(catalog key는 `Waiting for iPhone`, `Saved on iPhone`, `Not sent to iPhone`, `Send Again`, `Outside watch support`).
- Home은 `다이빙` 제목 아래 프리다이빙·스쿠버 시작 카드 두 개를 둔다. 센서 확인 중에는 placeholder나 빨간 카드 없이 실제 카드를 비활성으로 그린다. 수심 측정을 지원하지 않는 기기는 neutral 안내(`Depth-capable Apple Watch required`)를 보인다. `수중 조작` 행은 자동 실행 상태를 보이고 설정 안내 화면(자동 실행 상태, 동작 버튼 지정 방법, 크라운 안내)으로 들어간다. Demo는 아래쪽 보조 행(`가상 수심`)이다.
- 실제 기록 화면 아래에는 고정 안내 대신 한 줄 안내 chip을 둔다. chip은 다음 누르기가 무엇을 하는지 말한다. 물속은 `동작 버튼 ▸ 상세 1/2`, 수면에서 3분 전은 `기록 종료 가능까지 m:ss`, 종료 화면이 순환에 들어가면 Live에서 `동작 버튼 ▸ 상세 1/3`, 세부 화면에서 `동작 버튼 ▸ 종료 화면`, 종료 화면에서 `동작 버튼 ▸ 기록 종료·저장`이다. 거부된 누르기는 2초 동안 `지금은 기록을 끝낼 수 없음`을 보인다. 수중 잠금 안내는 물 밖일 때만 보인다. 동작 버튼이 없을 것 같은 기기는 같은 자리에 `크라운 ▸ 상세 1/2` 같은 크라운 안내를 쓴다. 안내 chip, 화면 넘김, 종료 화면에는 탭 대상이 없다.
- 모든 기록 화면(Live, 세부, 종료)은 왼쪽 depth gauge(46pt로 좁힘), 수심 상태 chip과 Demo/Test 표식, 지원 수심 밖 경고를 유지한다. 화면마다 큰 숫자는 하나다. 스쿠버 Live·세부와 프리다이빙 하강 중 화면에서는 실시간 수심이 live일 때만 수심이고 그 밖에는 경과 시간이며, 권장 스탑은 남은 스탑 시간, 프리다이빙 수면 화면은 기록 시간이나 수면 휴식 시간, 프리다이빙 세부 화면은 다이빙 횟수, 종료 화면은 경과 시간이다. 단위는 작은 별도 Text로 나누고 숫자는 rounded·고정폭으로 그린다. 페이지 점은 안내 chip 안에 둔다.
- 세부 화면은 이미 publish된 값만, 보조 값은 두 개까지 쓴다. 스쿠버는 최대 수심과 수온, 프리다이빙은 다이빙 횟수(큰 값), 직전 다이빙(시간·수심), 최장 다이빙이다. 평균 수심과 상승 참고값은 넣지 않는다.
- Always-On(`isLuminanceReduced`)에서는 Live 화면을 흰 숫자와 외곽선 gauge로 그리고 수심·시간 밖의 보조 숫자를 숨긴다. 권장 스탑 라벨과 일시정지 문구, 수심 상태 chip, Demo/Test 표식은 숨기지 않는다.
- Wet Ready는 다이빙 종류와 크라운 선택을 주 요소로 두고 터치 버튼은 44pt다. 시작 안내는 자동 실행 상태와 동작 버튼 힌트에 따라 `자동 실행이 켜져 있어 기록이 자동으로 시작됩니다.`, `동작 버튼에 Divenary를 지정했다면 눌러서 기록을 시작하세요.`, `입수 전에 다이빙 화면에서 기록을 시작하세요.` 중 하나이며 상태를 모르거나, 자동 실행이 꺼져 있고 동작 버튼 힌트가 없으면 마지막 문구다.
- 동작 버튼 유무와 Divenary 지정 여부를 알려 주는 공개 API가 없으므로 동작 버튼 문구는 항상 조건형("동작 버튼에 Divenary를 지정했다면 …")이다.
- 햅틱은 다이버가 한 조작의 확인에만 쓰고, 자동 화면 전환이나 센서·권장 스탑·상승 상태 변화에는 쓰지 않는다. view는 햅틱을 직접 울리지 않는다. 자세한 경계는 [안전 규칙](../domains/safety-rules.md)을 따른다.
- 저장 요약은 최대 수심과 시간을 먼저 두고 상태는 한 곳에만 보인다. 수심 측정 횟수는 상세 화면에만 둔다. 실제 기록에서 동작 버튼 힌트가 있으면 `동작 버튼 ▸ 다음 다이빙 시작` 안내를 보인다.
- 워치 화면은 300/400/600/700 글꼴 굵기만 쓰고 medium(500)은 쓰지 않는다.

### 접근성

- 탭과 선택 pill은 selected 상태를 노출하고, 목록 행은 button role을 갖는다.
- 아이콘만 있는 컨트롤과 별점·pill·chip은 44pt 터치 영역을 갖는다. 시각 크기를 유지해야 하면 `hitSlop`으로 넓힌다.
- 별점은 "5점 중 3점", 프로필 차트는 범위만 요약(`최대 수심 {{max}}`, `수온 {{min}}–{{max}}`)하고 샘플 수는 읽지 않으며, number wheel은 VoiceOver 증감 동작을 제공한다. 상세 화면의 뒤로 버튼은 모두 "뒤로"로 읽힌다.
- 목록 행과 Home 최근 기록 카드는 접근성 라벨 하나에 제목, 날짜, 데모·테스트·지원 수심 밖 표식, 수치를 담는다. 시각 badge가 접근성에서 숨어도 표식이 들리게 한다.
- 저장·삭제 실패, 로그인 오류, 진행 문구, 막힌 계획 확정 같은 알림은 `AccessibilityInfo.announceForAccessibility`로 한 번씩 알린다.
- 텍스트 입력은 보이는 라벨을 접근성 라벨로 넘겨 영어 기본값("Input Field")으로 읽히지 않게 한다. 2026-10-22 기준 로그 편집기, 검색창, 계획 편집기의 텍스트 입력(계획 제목, 다이빙 포인트, 목표, 훈련 목표)에 적용됐다. 버디·장비·태그 입력은 아직 보이는 라벨 대신 placeholder `쉼표로 구분`으로 읽힌다.
- Watch metric card와 summary row는 제목과 값을 하나의 요소로 읽는다.
- 폼 검증 메시지는 검증 시점의 언어로 만들고, 한국어는 라벨 받침에 맞춰 을/를·은/는을 고른다.

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
- 재조회가 이미 보이는 내용을 스켈레톤으로 덮거나, 1초 전에 spinner가 깜빡인다.
- 화면에 동기화, 세션, 샘플, guest, import 같은 개발자 용어나 원본 오류가 보이거나, 같은 개념이 화면마다 다른 이름으로 불린다.
- 워치 자동 화면 전환에서 햅틱이 울린다.

## 관련 문서

- [모바일 구조](../architecture/mobile.md)
- [Watch 앱 구조](../architecture/watch-app.md)
- [안전 규칙](../domains/safety-rules.md)
